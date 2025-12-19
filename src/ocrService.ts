import axios from 'axios';
import FormData from 'form-data';
import type { DocumentType, OCRResult, ValidationError } from './types.js';

const OCR_API_URL = 'https://ganada0037--ocr-serverless-split-ocrservice-analyze.modal.run';

// Base64 이미지를 Buffer로 변환
function base64ToBuffer(base64String: string): Buffer {
  // data:image/jpeg;base64, 형식의 prefix 제거
  const base64Data = base64String.replace(/^data:image\/\w+;base64,/, '');
  return Buffer.from(base64Data, 'base64');
}

// 서류 타입 추론 (텍스트 기반)
function inferDocumentTypeFromText(text: string): DocumentType {
  const lowerText = text.toLowerCase();

  if (lowerText.includes('자동차등록증') || lowerText.includes('차대번호') || lowerText.includes('자동차등록번호')) {
    return 'vehicle_registration';
  }
  if (lowerText.includes('완납') || lowerText.includes('자동차세') || lowerText.includes('납세증명') || lowerText.includes('지방세')) {
    return 'tax_payment';
  }
  if (lowerText.includes('인감증명') || lowerText.includes('본인서명') || lowerText.includes('매도용') || lowerText.includes('위임')) {
    return 'seal_certificate';
  }
  if (lowerText.includes('사업자등록') || lowerText.includes('사업자등록번호') || lowerText.includes('상호') || lowerText.includes('업태')) {
    return 'business_registration';
  }

  return 'vehicle_registration';
}

// merged_text에서 자동차등록증 정보 추출
function parseVehicleRegistration(text: string): Record<string, string> {
  const data: Record<string, string> = {};

  // 자동차등록번호 (차량번호)
  const regNumMatch = text.match(/자동차등록번호\s*([0-9]{2,3}[가-힣][0-9]{4})/);
  if (regNumMatch) {
    data['차량번호'] = regNumMatch[1];
  }

  // 최초등록일
  const firstRegMatch = text.match(/최초등록일\s*(\d{4}[-./]\d{2}[-./]\d{2})/);
  if (firstRegMatch) {
    data['최초등록일'] = firstRegMatch[1].replace(/[./]/g, '-');
  }

  // 차명 (차종)
  const carNameMatch = text.match(/차명\s*([가-힣a-zA-Z0-9()]+)/);
  if (carNameMatch) {
    data['차명'] = carNameMatch[1].replace(/[0-9]형식.*/, '').trim();
  }

  // 형식 및 연식
  const yearMatch = text.match(/형식및연식\s*(\d{4})/);
  if (yearMatch) {
    data['연식'] = yearMatch[1];
  }

  // 차대번호
  const vinMatch = text.match(/차별번호\s*([A-Z0-9]{17})/i) || text.match(/차대번호\s*([A-Z0-9]{17})/i);
  if (vinMatch) {
    data['차대번호'] = vinMatch[1].toUpperCase();
  }

  // 원동기형식 (엔진)
  const engineMatch = text.match(/원동기형식\s*([A-Z0-9]+)/i);
  if (engineMatch) {
    data['원동기형식'] = engineMatch[1];
  }

  // 성명 (소유자)
  const ownerMatch = text.match(/성명\s*\(?\s*명칭\s*\)?\s*([가-힣]+)/);
  if (ownerMatch) {
    data['소유자'] = ownerMatch[1];
  }

  // 주민등록번호
  const ssnMatch = text.match(/주민\s*\(?\s*사업자?\s*등록번호\s*\)?\s*(\d{6}[-]?\d{7})/);
  if (ssnMatch) {
    data['주민등록번호'] = ssnMatch[1].substring(0, 6) + '-*******';
  }

  // 사용본거지 (주소)
  const addrMatch = text.match(/사용본거지\s*([가-힣0-9\s-]+?)(?=\d*성명|\d*$)/);
  if (addrMatch) {
    data['사용본거지'] = addrMatch[1].trim();
  }

  // 배기량
  const dispMatch = text.match(/(\d{3,4})\s*cc/i);
  if (dispMatch) {
    data['배기량'] = dispMatch[1] + 'cc';
  }

  // 승차정원
  const capacityMatch = text.match(/승차\s*(\d+)\s*명/);
  if (capacityMatch) {
    data['승차정원'] = capacityMatch[1] + '명';
  }

  // 연료 종류
  const fuelMatch = text.match(/연료의\s*종류\s*\(?([가-힣]+)/);
  if (fuelMatch) {
    data['연료'] = fuelMatch[1];
  } else if (text.includes('휘발유') || text.includes('가솔린')) {
    data['연료'] = '휘발유';
  } else if (text.includes('경유') || text.includes('디젤')) {
    data['연료'] = '경유';
  }

  // 발급일 추출 (문서 마지막 부분의 날짜 = 발급일)
  // 모든 "YYYY년 MM월 DD일" 패턴을 찾아서 마지막 것을 발급일로 사용
  const allDateMatches = [...text.matchAll(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/g)];
  if (allDateMatches.length > 0) {
    const lastDateMatch = allDateMatches[allDateMatches.length - 1];
    const year = lastDateMatch[1];
    const month = lastDateMatch[2].padStart(2, '0');
    const day = lastDateMatch[3].padStart(2, '0');
    data['발급일'] = `${year}-${month}-${day}`;
  }

  return data;
}

// merged_text에서 납세증명서 정보 추출
function parseTaxPayment(text: string): Record<string, string> {
  const data: Record<string, string> = {};

  // 납세자 성명
  const nameMatch = text.match(/납세자\s*[:\s]*([가-힣]+)/) || text.match(/성명\s*[:\s]*([가-힣]+)/);
  if (nameMatch) {
    data['납세자'] = nameMatch[1];
  }

  // 차량번호
  const regNumMatch = text.match(/([0-9]{2,3}[가-힣][0-9]{4})/);
  if (regNumMatch) {
    data['차량번호'] = regNumMatch[1];
  }

  // 납부금액
  const amountMatch = text.match(/(\d{1,3}(,\d{3})*)\s*원/);
  if (amountMatch) {
    data['납부금액'] = amountMatch[1] + '원';
  }

  // 완납 여부
  if (text.includes('완납') || text.includes('체납없음')) {
    data['납부상태'] = '완납';
  }

  // 발급일 (문서 마지막 부분의 날짜)
  const allDateMatches = [...text.matchAll(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/g)];
  if (allDateMatches.length > 0) {
    const lastDateMatch = allDateMatches[allDateMatches.length - 1];
    const year = lastDateMatch[1];
    const month = lastDateMatch[2].padStart(2, '0');
    const day = lastDateMatch[3].padStart(2, '0');
    data['발급일'] = `${year}-${month}-${day}`;
  }

  return data;
}

// merged_text에서 인감증명서 정보 추출
function parseSealCertificate(text: string): Record<string, string> {
  const data: Record<string, string> = {};

  // 성명
  const nameMatch = text.match(/성명\s*[:\s]*([가-힣]+)/) || text.match(/본인\s*[:\s]*([가-힣]+)/);
  if (nameMatch) {
    data['성명'] = nameMatch[1];
  }

  // 주민등록번호 (마스킹)
  const ssnMatch = text.match(/(\d{6})[-\s]*\d{7}/);
  if (ssnMatch) {
    data['주민등록번호'] = ssnMatch[1] + '-*******';
  }

  // 주소
  const addrMatch = text.match(/주소\s*[:\s]*([가-힣0-9\s-]+?)(?=용도|$)/);
  if (addrMatch) {
    data['주소'] = addrMatch[1].trim();
  }

  // 용도
  if (text.includes('매도')) {
    data['용도'] = '매도용';
  } else if (text.includes('위임')) {
    data['용도'] = '위임용';
  }

  // 발급일 (문서 마지막 부분의 날짜)
  const allDateMatches = [...text.matchAll(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/g)];
  if (allDateMatches.length > 0) {
    const lastDateMatch = allDateMatches[allDateMatches.length - 1];
    const year = lastDateMatch[1];
    const month = lastDateMatch[2].padStart(2, '0');
    const day = lastDateMatch[3].padStart(2, '0');
    data['발급일'] = `${year}-${month}-${day}`;
  }

  return data;
}

// merged_text에서 사업자등록증 정보 추출
function parseBusinessRegistration(text: string): Record<string, string> {
  const data: Record<string, string> = {};

  // 상호
  const companyMatch = text.match(/상호\s*[:\s]*([가-힣a-zA-Z0-9\s]+?)(?=대표|사업|$)/);
  if (companyMatch) {
    data['상호'] = companyMatch[1].trim();
  }

  // 대표자
  const repMatch = text.match(/대표자\s*[:\s]*([가-힣]+)/);
  if (repMatch) {
    data['대표자'] = repMatch[1];
  }

  // 사업자등록번호
  const bizNumMatch = text.match(/(\d{3}[-]\d{2}[-]\d{5})/);
  if (bizNumMatch) {
    data['사업자등록번호'] = bizNumMatch[1];
  }

  // 업태
  const bizTypeMatch = text.match(/업태\s*[:\s]*([가-힣\s]+?)(?=종목|$)/);
  if (bizTypeMatch) {
    data['업태'] = bizTypeMatch[1].trim();
  }

  // 발급일 (문서 마지막 부분의 날짜)
  const allDateMatches = [...text.matchAll(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/g)];
  if (allDateMatches.length > 0) {
    const lastDateMatch = allDateMatches[allDateMatches.length - 1];
    const year = lastDateMatch[1];
    const month = lastDateMatch[2].padStart(2, '0');
    const day = lastDateMatch[3].padStart(2, '0');
    data['발급일'] = `${year}-${month}-${day}`;
  }

  return data;
}

// merged_text에서 문서 타입에 따라 필드 추출
function parseDocumentFromMergedText(mergedText: string): { documentType: DocumentType; extractedData: Record<string, string> } {
  const documentType = inferDocumentTypeFromText(mergedText);
  let extractedData: Record<string, string> = {};

  switch (documentType) {
    case 'vehicle_registration':
      extractedData = parseVehicleRegistration(mergedText);
      break;
    case 'tax_payment':
      extractedData = parseTaxPayment(mergedText);
      break;
    case 'seal_certificate':
      extractedData = parseSealCertificate(mergedText);
      break;
    case 'business_registration':
      extractedData = parseBusinessRegistration(mergedText);
      break;
  }

  return { documentType, extractedData };
}

// 서류 타입 추론 (extractedData 기반 - 레거시 호환)
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
    let extractedData: Record<string, string> = {};
    let documentType: DocumentType;
    let avgConfidence = 0.85;

    // merged_text가 있으면 우선적으로 파싱 (새 API 형식)
    if (ocrData.merged_text && typeof ocrData.merged_text === 'string') {
      console.log('Using merged_text for parsing');
      const parsed = parseDocumentFromMergedText(ocrData.merged_text);
      documentType = parsed.documentType;
      extractedData = parsed.extractedData;

      // confidence 계산 (results 배열에서)
      if (ocrData.results && Array.isArray(ocrData.results)) {
        let totalConfidence = 0;
        let confidenceCount = 0;
        ocrData.results.forEach((result: any) => {
          if (result.confidence && typeof result.confidence.ocr === 'number') {
            totalConfidence += result.confidence.ocr;
            confidenceCount++;
          }
        });
        if (confidenceCount > 0) {
          avgConfidence = totalConfidence / confidenceCount;
        }
      }

      console.log('Parsed document type:', documentType);
      console.log('Extracted data:', extractedData);
    }
    // 기존 API 응답 형식 처리 (fallback)
    else if (ocrData.status === 'success' && ocrData.results && Array.isArray(ocrData.results)) {
      let totalConfidence = 0;
      let confidenceCount = 0;

      if (ocrData.results.length === 0) {
        extractedData['인식결과'] = '텍스트를 인식할 수 없습니다.';
      } else {
        ocrData.results.forEach((result: any) => {
          if (result.field && result.value) {
            extractedData[result.field] = result.value;
          }
          if (result.confidence && typeof result.confidence.ocr === 'number') {
            totalConfidence += result.confidence.ocr;
            confidenceCount++;
          }
        });
      }

      avgConfidence = confidenceCount > 0 ? totalConfidence / confidenceCount : 0.85;
      documentType = ocrData.document_type || inferDocumentType(extractedData);
    }
    // extracted_text 형식 (레거시)
    else if (ocrData.extracted_text) {
      if (typeof ocrData.extracted_text === 'string') {
        const parsed = parseDocumentFromMergedText(ocrData.extracted_text);
        documentType = parsed.documentType;
        extractedData = parsed.extractedData;
      } else if (typeof ocrData.extracted_text === 'object') {
        Object.assign(extractedData, ocrData.extracted_text);
        documentType = inferDocumentType(extractedData);
      } else {
        documentType = 'vehicle_registration';
      }
      avgConfidence = ocrData.confidence || 0.85;
    }
    // 기타
    else {
      documentType = 'vehicle_registration';
      extractedData = { '인식결과': 'OCR 결과를 파싱할 수 없습니다.' };
    }

    if (ocrData.fields) {
      Object.assign(extractedData, ocrData.fields);
    }

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

// 여러 서류 간 일관성 검증
export function validateDocumentConsistency(documents: Array<{ ocrResult?: OCRResult }>): ValidationError[] {
  const errors: ValidationError[] = [];
  const ocrResults = documents
    .filter((doc) => doc.ocrResult)
    .map((doc) => doc.ocrResult!);

  if (ocrResults.length < 2) {
    return errors; // 서류가 2개 미만이면 비교 불가
  }

  // 모든 서류에서 차량번호 추출
  const vehicleNumbers: string[] = [];
  const ownerNames: string[] = [];

  for (const ocr of ocrResults) {
    const data = ocr.extractedData;

    // 차량번호 수집 (다양한 필드명 지원)
    const vehicleNum = data['차량번호'] || data['등록번호'] || data['자동차번호'];
    if (vehicleNum) {
      vehicleNumbers.push(vehicleNum.replace(/\s+/g, ''));
    }

    // 소유자 이름 수집
    const ownerName = data['소유자'] || data['성명'] || data['납세자'] || data['대표자'] || data['본인'];
    if (ownerName) {
      ownerNames.push(ownerName.replace(/\s+/g, ''));
    }
  }

  // 차량번호 일관성 검증
  if (vehicleNumbers.length >= 2) {
    const uniqueVehicleNumbers = [...new Set(vehicleNumbers)];
    if (uniqueVehicleNumbers.length > 1) {
      errors.push({
        field: '차량번호 불일치',
        message: `서류 간 차량번호가 다릅니다: ${uniqueVehicleNumbers.join(', ')}`,
        severity: 'error',
      });
    }
  }

  // 소유자 이름 일관성 검증
  if (ownerNames.length >= 2) {
    const uniqueOwnerNames = [...new Set(ownerNames)];
    if (uniqueOwnerNames.length > 1) {
      errors.push({
        field: '소유자 불일치',
        message: `서류 간 소유자 이름이 다릅니다: ${uniqueOwnerNames.join(', ')}`,
        severity: 'warning',
      });
    }
  }

  return errors;
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
