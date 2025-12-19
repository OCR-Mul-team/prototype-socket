import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import type { CustomerSession, UploadedDocument, VehicleInfo, OCRResult } from './types.js';
import { analyzeDocument, mockAnalyzeDocument, validateDocumentConsistency } from './ocrService.js';
import { predictPrice } from './priceService.js';

const app = express();
const httpServer = createServer(app);

// CORS 설정
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:5173'],
  credentials: true,
}));

app.use(express.json({ limit: '50mb' }));

// Socket.IO 설정
const io = new Server(httpServer, {
  cors: {
    origin: ['http://localhost:3000', 'http://localhost:5173'],
    methods: ['GET', 'POST'],
    credentials: true,
  },
  maxHttpBufferSize: 50 * 1024 * 1024, // 50MB
});

// 세션 저장소
const sessions = new Map<string, CustomerSession>();

// 상담원 소켓 ID 저장소
const agentSockets = new Set<string>();

// 세션 ID 생성 (전화번호 기반)
function generateSessionId(phoneNumber: string): string {
  const normalized = phoneNumber.replace(/[-\s]/g, '');
  const timestamp = Date.now().toString(36);
  return `session_${normalized}_${timestamp}`;
}

// 모든 상담원에게 메시지 전송
function broadcastToAgents(event: string, data: unknown) {
  agentSockets.forEach((socketId) => {
    io.to(socketId).emit(event, data);
  });
}

// 고객 소켓에 메시지 전송
function sendToCustomer(session: CustomerSession, event: string, data: unknown) {
  if (session.customerSocketId) {
    io.to(session.customerSocketId).emit(event, data);
  }
}

// Socket.IO 이벤트 핸들러
io.on('connection', (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);

  // === 고객 이벤트 ===

  // 고객 세션 참가
  socket.on('customer:join', (data: { phoneNumber: string; customerName: string }) => {
    const { phoneNumber, customerName } = data;
    console.log(`[Customer] Join request from ${customerName} (${phoneNumber})`);

    // 기존 세션 확인 또는 새 세션 생성
    let session = Array.from(sessions.values()).find(
      (s) => s.phoneNumber === phoneNumber && s.status === 'active'
    );

    if (!session) {
      const sessionId = generateSessionId(phoneNumber);
      session = {
        sessionId,
        phoneNumber,
        customerName,
        createdAt: new Date(),
        status: 'active',
        documents: [],
        customerSocketId: socket.id,
      };
      sessions.set(sessionId, session);
      console.log(`[Customer] New session created: ${sessionId}`);

      // 상담원들에게 새 세션 알림
      broadcastToAgents('agent:new_session', session);
    } else {
      // 기존 세션에 소켓 ID 및 이름 업데이트
      session.customerSocketId = socket.id;
      session.customerName = customerName;
      sessions.set(session.sessionId, session);
      console.log(`[Customer] Existing session reconnected: ${session.sessionId}`);
    }

    // 고객에게 세션 정보 전송
    socket.emit('customer:session_created', session);
  });

  // 서류 업로드
  socket.on('customer:upload_document', async (document: UploadedDocument) => {
    console.log(`[Customer] Document uploaded: ${document.id}`);

    // 세션 찾기
    const session = Array.from(sessions.values()).find(
      (s) => s.customerSocketId === socket.id
    );

    if (!session) {
      console.error('[Customer] Session not found for document upload');
      return;
    }

    // 서류 상태를 처리중으로 변경
    document.status = 'processing';
    session.documents.push(document);
    sessions.set(session.sessionId, session);

    // 상담원에게 서류 업로드 알림
    broadcastToAgents('agent:document_uploaded', {
      sessionId: session.sessionId,
      document,
    });

    // 고객에게 처리중 알림
    socket.emit('customer:ocr_processing', document.id);

    // OCR 처리 (비동기)
    try {
      // 실제 OCR 또는 모의 OCR 사용
      const useMockOcr = process.env.USE_MOCK_OCR === 'true';
      let ocrResult: OCRResult;

      if (useMockOcr) {
        // 모의 OCR (테스트용)
        await new Promise((resolve) => setTimeout(resolve, 2000)); // 2초 딜레이
        const types: Array<'vehicle_registration' | 'tax_payment' | 'seal_certificate' | 'business_registration'> = [
          'vehicle_registration',
          'tax_payment',
          'seal_certificate',
          'business_registration',
        ];
        const randomType = types[Math.floor(Math.random() * types.length)];
        ocrResult = mockAnalyzeDocument(randomType);
      } else {
        // 실제 OCR API 호출
        ocrResult = await analyzeDocument(document.fileUrl, document.fileName);
      }

      // 서류 정보 업데이트
      const docIndex = session.documents.findIndex((d) => d.id === document.id);
      if (docIndex !== -1) {
        session.documents[docIndex] = {
          ...session.documents[docIndex],
          type: ocrResult.documentType,
          status: ocrResult.isValid ? 'valid' : 'needs_review',
          ocrResult,
        };
        sessions.set(session.sessionId, session);
      }

      // 상담원에게 OCR 결과 전송
      broadcastToAgents('agent:ocr_completed', {
        sessionId: session.sessionId,
        documentId: document.id,
        ocrResult,
      });

      // 고객에게도 OCR 완료 알림 (문서 정보 업데이트용)
      sendToCustomer(session, 'customer:ocr_completed', {
        documentId: document.id,
        ocrResult,
      });

      // 서류 간 일관성 검증 (2개 이상의 서류가 OCR 완료된 경우)
      const consistencyErrors = validateDocumentConsistency(session.documents);
      if (consistencyErrors.length > 0) {
        console.log(`[Validation] Consistency errors found:`, consistencyErrors);

        // 상담원에게 일관성 검증 오류 알림
        broadcastToAgents('agent:consistency_check', {
          sessionId: session.sessionId,
          errors: consistencyErrors,
        });

        // 고객에게도 알림 (경고 성격)
        sendToCustomer(session, 'customer:consistency_warning', {
          errors: consistencyErrors,
        });
      }

      console.log(`[OCR] Completed for document ${document.id}`);
    } catch (error) {
      console.error('[OCR] Error:', error);
    }
  });

  // 차량 정보 제출
  socket.on('customer:submit_vehicle_info', (vehicleInfo: VehicleInfo) => {
    console.log(`[Customer] Vehicle info submitted`);

    const session = Array.from(sessions.values()).find(
      (s) => s.customerSocketId === socket.id
    );

    if (!session) {
      console.error('[Customer] Session not found for vehicle info');
      return;
    }

    session.vehicleInfo = vehicleInfo;
    sessions.set(session.sessionId, session);

    // 상담원에게 차량 정보 알림
    broadcastToAgents('agent:vehicle_info_submitted', {
      sessionId: session.sessionId,
      vehicleInfo,
    });
  });

  // === 상담원 이벤트 ===

  // 상담원 참가
  socket.on('agent:join', (agentId: string) => {
    console.log(`[Agent] Joined: ${agentId}`);
    agentSockets.add(socket.id);

    // 현재 활성 세션 목록 전송
    const activeSessions = Array.from(sessions.values()).filter(
      (s) => s.status === 'active'
    );

    activeSessions.forEach((session) => {
      socket.emit('agent:new_session', session);
    });
  });

  // 추가 서류 요청
  socket.on('agent:request_additional_document', (sessionId: string, message: string) => {
    console.log(`[Agent] Additional document request for ${sessionId}: ${message}`);

    const session = sessions.get(sessionId);
    if (!session) {
      console.error('[Agent] Session not found:', sessionId);
      return;
    }

    session.additionalDocumentRequest = message;
    sessions.set(sessionId, session);

    // 고객에게 추가 서류 요청 전송
    sendToCustomer(session, 'customer:additional_document_request', message);
  });

  // OCR 결과 수정
  socket.on(
    'agent:update_ocr_result',
    (sessionId: string, documentId: string, ocrResult: OCRResult) => {
      console.log(`[Agent] OCR result updated for ${sessionId}/${documentId}`);

      const session = sessions.get(sessionId);
      if (!session) return;

      const docIndex = session.documents.findIndex((d) => d.id === documentId);
      if (docIndex !== -1) {
        session.documents[docIndex].ocrResult = ocrResult;
        session.documents[docIndex].status = ocrResult.isValid ? 'valid' : 'needs_review';
        sessions.set(sessionId, session);
      }

      // 세션 업데이트를 모든 상담원에게 전송
      broadcastToAgents('agent:session_updated', session);
    }
  );

  // 가격 보고서 전송
  socket.on('agent:send_price_report', async (sessionId: string) => {
    console.log(`[Agent] Price report request for ${sessionId}`);

    const session = sessions.get(sessionId);
    if (!session || !session.vehicleInfo) {
      console.error('[Agent] Session or vehicle info not found:', sessionId);
      return;
    }

    try {
      // 가격 예측 실행
      const prediction = await predictPrice(session.vehicleInfo);

      session.pricePrediction = prediction;
      sessions.set(sessionId, session);

      // 고객에게 가격 보고서 전송
      sendToCustomer(session, 'customer:price_report', prediction);

      console.log(`[Agent] Price report sent to customer: ${prediction.predictedPrice}`);
    } catch (error) {
      console.error('[Agent] Price prediction error:', error);
    }
  });

  // 연결 해제
  socket.on('disconnect', () => {
    console.log(`[Socket] Client disconnected: ${socket.id}`);

    // 상담원 목록에서 제거
    agentSockets.delete(socket.id);

    // 고객 세션에서 소켓 ID 제거 (세션은 유지)
    sessions.forEach((session) => {
      if (session.customerSocketId === socket.id) {
        session.customerSocketId = undefined;
      }
    });
  });
});

// REST API 엔드포인트

// 헬스 체크
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 세션 목록 조회 (디버깅용)
app.get('/api/sessions', (_req, res) => {
  const allSessions = Array.from(sessions.values());
  res.json(allSessions);
});

// 서버 시작
const PORT = process.env.PORT || 4000;

httpServer.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🚗 AutoScan Sell Backend Server                         ║
║                                                           ║
║   Server running on http://localhost:${PORT}                 ║
║   Socket.IO enabled                                       ║
║                                                           ║
║   Environment:                                            ║
║   - USE_MOCK_OCR: ${process.env.USE_MOCK_OCR || 'false'}                               ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
});
