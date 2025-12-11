// 서류 타입
export type DocumentType =
  | 'vehicle_registration'    // 자동차등록증
  | 'tax_payment'             // 자동차세 완납증명서
  | 'seal_certificate'        // 인감증명서
  | 'business_registration';  // 사업자등록증

// 서류 검증 상태
export type DocumentStatus =
  | 'pending'
  | 'processing'
  | 'valid'
  | 'invalid'
  | 'expired'
  | 'needs_review';

// 업로드된 서류 정보
export interface UploadedDocument {
  id: string;
  type: DocumentType | null;
  fileName: string;
  fileUrl: string;
  uploadedAt: Date;
  status: DocumentStatus;
  ocrResult?: OCRResult;
}

// OCR 결과
export interface OCRResult {
  documentType: DocumentType;
  extractedData: Record<string, string>;
  confidence: number;
  validationErrors: ValidationError[];
  isValid: boolean;
  expiryDate?: string;
}

// 검증 오류
export interface ValidationError {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

// 차량 정보
export interface VehicleInfo {
  modelName: 'Hyundai' | 'Genesis';
  ageMonths: number;
  distance: number;
  displacement: number;
  fuel: 'diesel' | 'gasoline' | 'electric' | 'hybrid' | 'lpg';
  color: 'black' | 'white' | 'gray' | 'other';
  newPrice: number;
  sunroof: boolean;
  panoramaSunroof: boolean;
  frontSeatHeater: boolean;
  rearSeatHeater: boolean;
  rearSensor: boolean;
  rearCamera: boolean;
  aroundView: boolean;
  navigation: boolean;
  ownerChange: '0' | '1' | '2' | '3+';
  majorDefect: 'low(0-2)' | 'mid(3-10)' | 'high(11+)';
  minorDefect: 'low(0-5)' | 'mid(6-15)' | 'high(16+)';
}

// 가격 예측 결과
export interface PricePrediction {
  predictedPrice: number;
  priceRange: {
    min: number;
    max: number;
  };
  factors: PriceFactor[];
}

export interface PriceFactor {
  name: string;
  impact: 'positive' | 'negative' | 'neutral';
  description: string;
}

// 세션 정보
export interface CustomerSession {
  sessionId: string;
  phoneNumber: string;
  customerName?: string;
  createdAt: Date;
  status: 'active' | 'completed' | 'cancelled';
  documents: UploadedDocument[];
  vehicleInfo?: VehicleInfo;
  pricePrediction?: PricePrediction;
  additionalDocumentRequest?: string;
  customerSocketId?: string;
}

// 상담원 정보
export interface Agent {
  id: string;
  name: string;
  employeeId: string;
  socketId?: string;
}
