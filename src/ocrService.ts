import axios from 'axios';
import FormData from 'form-data';
import type { DocumentType, OCRResult, ValidationError } from './types.js';

const OCR_API_URL = 'https://ganada0037--ocr-serverless-split-ocrservice-analyze-dev.modal.run';

// Base64 이미지를 Buffer로 변환
function base64ToBuffer(base64String: string): Buffer {
  // data:image/jpeg;base64, 형식의 prefix 제거
  const base64Data = base64String.replace(/^data:image\/\w+;base64,/, '');
  return Buffer.from(base64Data, 'base64');
}

// 서류 타입 추론
function inferDocumentType(extractedData: Record<string, string>): DocumentType {
  const dataString = JSON.stringify(extractedData).toLowerCase();

  if (dataString.includes('자동차등록증') || dataString.includes('등록번호') || dataString.includes('차대번호')) {
    return 'vehicle_registration';
  }
  if (dataString.includes('완납') || dataString.includes('자동차세') || dataString.includes('납세증명')) {
    return 'tax_payment';
  }
  if (dataString.includes('인감') || dataString.includes('매도') || dataString.includes('위임')) {
    return 'seal_certificate';
  }
  if (dataString.includes('사업자') || dataString.includes('상호') || dataString.includes('대표자')) {
    return 'business_registration';
  }

  // 기본값
  return 'vehicle_registration';
}

// 서류 유효성 검증
function validateDocument(
  documentType: DocumentType,
  extractedData: Record<string, string>
): { isValid: boolean; errors: ValidationError[]; expiryDate?: string } {
  const errors: ValidationError[] = [];
  let expiryDate: string | undefined;

  // 발급일 기준 유효기간 검증 (30일)
  const issueDateStr = extractedData['발급일'] || extractedData['발행일'] || extractedData['교부일'];
  if (issueDateStr) {
    const issueDate = new Date(issueDateStr.replace(/\./g, '-'));
    const today = new Date();
    const diffDays = Math.floor((today.getTime() - issueDate.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays > 30) {
      errors.push({
        field: '유효기간',
        message: `서류 발급일로부터 ${diffDays}일이 경과했습니다. (30일 초과)`,
        severity: 'error',
      });
    }

    // 만료일 계산
    const expiry = new Date(issueDate);
    expiry.setDate(expiry.getDate() + 30);
    expiryDate = expiry.toISOString().split('T')[0];
  }

  // 서류 타입별 필수 필드 검증
  switch (documentType) {
    case 'vehicle_registration':
      if (!extractedData['차량번호'] && !extractedData['등록번호']) {
        errors.push({
          field: '차량번호',
          message: '차량번호를 확인할 수 없습니다.',
          severity: 'error',
        });
      }
      if (!extractedData['소유자'] && !extractedData['성명']) {
        errors.push({
          field: '소유자',
          message: '소유자 정보를 확인할 수 없습니다.',
          severity: 'warning',
        });
      }
      break;

    case 'tax_payment':
      if (!extractedData['납세자'] && !extractedData['성명']) {
        errors.push({
          field: '납세자',
          message: '납세자 정보를 확인할 수 없습니다.',
          severity: 'error',
        });
      }
      break;

    case 'seal_certificate':
      if (!extractedData['성명'] && !extractedData['본인']) {
        errors.push({
          field: '성명',
          message: '인감 소유자를 확인할 수 없습니다.',
          severity: 'error',
        });
      }
      break;

    case 'business_registration':
      if (!extractedData['상호'] && !extractedData['사업장명']) {
        errors.push({
          field: '상호',
          message: '사업장 정보를 확인할 수 없습니다.',
          severity: 'error',
        });
      }
      if (!extractedData['사업자등록번호']) {
        errors.push({
          field: '사업자등록번호',
          message: '사업자등록번호를 확인할 수 없습니다.',
          severity: 'error',
        });
      }
      break;
  }

  const isValid = errors.filter((e) => e.severity === 'error').length === 0;

  return { isValid, errors, expiryDate };
}

// OCR 분석 실행
export async function analyzeDocument(fileUrl: string, fileName: string): Promise<OCRResult> {
  try {
    // Base64 이미지를 Buffer로 변환
    const imageBuffer = base64ToBuffer(fileUrl);

    // FormData 생성
    const formData = new FormData();
    formData.append('file', imageBuffer, {
      filename: fileName,
      contentType: 'image/jpeg',
    });

    // OCR API 호출
    const response = await axios.post(OCR_API_URL, formData, {
      headers: {
        ...formData.getHeaders(),
      },
      timeout: 30000,
    });

    const ocrData = response.data;
    console.log('OCR API Response:', JSON.stringify(ocrData, null, 2));

    // 추출된 데이터 정리
    const extractedData: Record<string, string> = {};
    let totalConfidence = 0;
    let confidenceCount = 0;

    // 새로운 API 응답 형식 처리: {"status":"success","count":N,"results":[...]}
    if (ocrData.status === 'success' && ocrData.results && Array.isArray(ocrData.results)) {
      if (ocrData.results.length === 0) {
        extractedData['인식결과'] = '텍스트를 인식할 수 없습니다.';
      } else {
        // results 배열에서 데이터 추출
        ocrData.results.forEach((result: any, index: number) => {
          if (result.text) {
            extractedData[`텍스트_${index + 1}`] = result.text;
          }
          if (result.field && result.value) {
            extractedData[result.field] = result.value;
          }
          // confidence 값 수집 (ocr 신뢰도 사용)
          if (result.confidence && typeof result.confidence.ocr === 'number') {
            totalConfidence += result.confidence.ocr;
            confidenceCount++;
          }
          // 다른 형식의 결과도 처리
          if (typeof result === 'object') {
            Object.entries(result).forEach(([key, value]) => {
              if (key !== 'text' && key !== 'confidence' && key !== 'bbox' && key !== 'id' && typeof value === 'string') {
                extractedData[key] = value;
              }
            });
          }
        });
      }
    } else if (ocrData.extracted_text) {
      // 기존 API 응답 형식 처리 (fallback)
      if (typeof ocrData.extracted_text === 'string') {
        extractedData['원본텍스트'] = ocrData.extracted_text;
      } else if (typeof ocrData.extracted_text === 'object') {
        Object.assign(extractedData, ocrData.extracted_text);
      }
    }

    if (ocrData.fields) {
      Object.assign(extractedData, ocrData.fields);
    }

    // 평균 신뢰도 계산
    const avgConfidence = confidenceCount > 0
      ? totalConfidence / confidenceCount
      : (ocrData.confidence || 0.85);

    // 서류 타입 추론
    const documentType = ocrData.document_type || inferDocumentType(extractedData);

    // 유효성 검증
    const validation = validateDocument(documentType, extractedData);

    return {
      documentType,
      extractedData,
      confidence: avgConfidence,
      validationErrors: validation.errors,
      isValid: validation.isValid,
      expiryDate: validation.expiryDate,
    };
  } catch (error: any) {
    console.error('OCR API error:', error?.response?.status, error?.message);

    // API가 중지된 경우 (404) 또는 기타 오류 시 mock 데이터 사용
    const isApiStopped = error?.response?.status === 404 ||
                         error?.message?.includes('modal-http') ||
                         error?.code === 'ECONNREFUSED';

    if (isApiStopped) {
      console.log('OCR API is stopped, using mock data with random document type');
      // 랜덤하게 서류 타입 선택하여 mock 데이터 반환
      const documentTypes: DocumentType[] = ['vehicle_registration', 'tax_payment', 'seal_certificate', 'business_registration'];
      const randomType = documentTypes[Math.floor(Math.random() * documentTypes.length)];
      const mockResult = mockAnalyzeDocument(randomType);

      // mock 데이터임을 표시
      mockResult.extractedData['[참고]'] = 'API 연결 오류로 테스트 데이터가 표시됩니다';

      return mockResult;
    }

    // 기타 오류 시 기본 결과 반환
    return {
      documentType: 'vehicle_registration',
      extractedData: {
        오류: 'OCR 처리 중 오류가 발생했습니다.',
      },
      confidence: 0,
      validationErrors: [
        {
          field: 'OCR',
          message: 'OCR 처리에 실패했습니다. 다시 시도해주세요.',
          severity: 'error',
        },
      ],
      isValid: false,
    };
  }
}

// 모의 OCR 결과 생성 (테스트용)
export function mockAnalyzeDocument(documentType: DocumentType): OCRResult {
  const mockData: Record<DocumentType, Record<string, string>> = {
    vehicle_registration: {
      차량번호: '12가 3456',
      차종: '쏘나타',
      연식: '2021',
      소유자: '홍길동',
      차대번호: 'KMHXX00X0XX000000',
      등록일: '2021-03-15',
      발급일: new Date().toISOString().split('T')[0],
    },
    tax_payment: {
      납세자: '홍길동',
      차량번호: '12가 3456',
      납부금액: '520,000원',
      납부일: '2024-12-01',
      발급일: new Date().toISOString().split('T')[0],
    },
    seal_certificate: {
      성명: '홍길동',
      주민등록번호: '******-*******',
      주소: '서울특별시 강남구',
      용도: '매도용',
      발급일: new Date().toISOString().split('T')[0],
    },
    business_registration: {
      상호: '홍길동 자동차',
      대표자: '홍길동',
      사업자등록번호: '123-45-67890',
      업태: '자동차 판매',
      발급일: new Date().toISOString().split('T')[0],
    },
  };

  const extractedData = mockData[documentType];
  const validation = validateDocument(documentType, extractedData);

  return {
    documentType,
    extractedData,
    confidence: 0.92,
    validationErrors: validation.errors,
    isValid: validation.isValid,
    expiryDate: validation.expiryDate,
  };
}
