# AutoScan Sell - Backend

현대자동차 인증중고차 매입 서비스를 위한 백엔드 서버입니다.

## 프로젝트 소개

AutoScan Sell 백엔드는 고객과 상담원 간의 실시간 통신을 담당하고, OCR 및 가격 예측 API를 중계하는 서버입니다. Socket.IO를 통해 실시간 양방향 통신을 지원합니다.

### 주요 기능

- **실시간 통신**: Socket.IO를 통한 고객-상담원 간 실시간 데이터 동기화
- **세션 관리**: 고객 세션 생성, 조회, 상태 관리
- **OCR 서비스**: 외부 OCR API 호출 및 결과 처리
- **가격 예측 서비스**: 외부 ML API 호출 및 결과 처리
- **서류 검증**: 업로드된 서류의 유효성 검사 (유효기간, 필수 필드 등)

## 기술 스택

- **Node.js** + **TypeScript**
- **Express** - 웹 프레임워크
- **Socket.IO** - 실시간 통신
- **Axios** - HTTP 클라이언트
- **tsx** - TypeScript 실행 도구

## 프로젝트 구조

```
src/
├── index.ts          # 서버 진입점, Socket.IO 이벤트 핸들러
├── ocrService.ts     # OCR API 연동 및 서류 검증
├── priceService.ts   # 가격 예측 API 연동
└── types.ts          # TypeScript 타입 정의
```

## 시작하기

### 사전 요구사항

- Node.js 18.x 이상
- npm 또는 yarn

### 설치

```bash
# 저장소 클론
git clone <repository-url>
cd autoscan-sell-backend

# 의존성 설치
npm install
```

### 개발 서버 실행

```bash
npm run dev
```

서버가 `http://localhost:3001`에서 실행됩니다.

### 프로덕션 빌드 및 실행

```bash
# TypeScript 빌드
npm run build

# 프로덕션 서버 실행
npm start
```

## API 엔드포인트

### REST API

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/` | 서버 상태 확인 |

### Socket.IO 이벤트

#### 클라이언트 → 서버

| 이벤트 | 설명 | 데이터 |
|--------|------|--------|
| `customer:start-session` | 고객 세션 시작 | `{ phoneNumber: string }` |
| `customer:upload-document` | 서류 업로드 | `{ sessionId, document }` |
| `customer:submit-vehicle-info` | 차량 정보 제출 | `{ sessionId, vehicleInfo }` |
| `agent:login` | 상담원 로그인 | `{ name, employeeId }` |
| `agent:select-session` | 세션 선택 | `{ sessionId }` |
| `agent:request-document` | 추가 서류 요청 | `{ sessionId, message }` |

#### 서버 → 클라이언트

| 이벤트 | 설명 | 데이터 |
|--------|------|--------|
| `session:created` | 세션 생성 완료 | `{ session }` |
| `session:updated` | 세션 정보 업데이트 | `{ session }` |
| `sessions:list` | 전체 세션 목록 | `{ sessions }` |
| `ocr:result` | OCR 분석 결과 | `{ documentId, result }` |
| `price:result` | 가격 예측 결과 | `{ sessionId, prediction }` |
| `document:request` | 추가 서류 요청 알림 | `{ message }` |

## 타입 정의

### DocumentType (서류 유형)
```typescript
type DocumentType =
  | 'vehicle_registration'    // 자동차등록증
  | 'tax_payment'             // 자동차세 완납증명서
  | 'seal_certificate'        // 인감증명서
  | 'business_registration'   // 사업자등록증
```

### VehicleInfo (차량 정보)
```typescript
interface VehicleInfo {
  modelName: 'Hyundai' | 'Genesis'
  ageMonths: number           // 차량 연식 (개월)
  distance: number            // 주행거리 (km)
  displacement: number        // 배기량 (cc)
  fuel: 'diesel' | 'gasoline' | 'electric' | 'hybrid' | 'lpg'
  color: 'black' | 'white' | 'gray' | 'other'
  newPrice: number            // 신차 가격
  sunroof: boolean
  panoramaSunroof: boolean
  frontSeatHeater: boolean
  rearSeatHeater: boolean
  rearSensor: boolean
  rearCamera: boolean
  aroundView: boolean
  navigation: boolean
  ownerChange: '0' | '1' | '2' | '3+'
  majorDefect: 'low(0-2)' | 'mid(3-10)' | 'high(11+)'
  minorDefect: 'low(0-5)' | 'mid(6-15)' | 'high(16+)'
}
```

### PricePrediction (가격 예측 결과)
```typescript
interface PricePrediction {
  predictedPrice: number
  priceRange: {
    min: number
    max: number
  }
  factors: PriceFactor[]
}
```

## 외부 API 연동

### OCR API (Modal)
- URL: `https://ganada0037--ocr-serverless-split-ocrservice-analyze-dev.modal.run`
- Method: POST
- Content-Type: multipart/form-data
- 요청: 이미지 파일 (Base64 → Buffer 변환)
- 응답:
```json
{
  "status": "success",
  "count": 5,
  "results": [
    {
      "text": "인식된 텍스트",
      "confidence": { "yolo": 0.66, "ocr": 0.99 }
    }
  ]
}
```

### 가격 예측 API (AWS Lambda)
- URL: `https://xgltqfyf77.execute-api.ap-northeast-2.amazonaws.com/predict`
- Method: POST
- Content-Type: application/json
- 요청:
```json
{
  "model_name": "Hyundai",
  "age_text": 36,
  "log_distance": 50000,
  "fuel": "가솔린",
  "color": "흰색",
  "new_price": 35000000,
  "sunroof": 1,
  "panorama_sunroof": 0,
  ...
}
```
- 응답:
```json
{
  "predicted_price": 25000000
}
```

## 서류 검증 로직

### 유효기간 검증
- 서류 발급일로부터 30일 이내인지 확인
- 30일 초과 시 `error` 수준의 검증 오류 반환

### 서류별 필수 필드

| 서류 유형 | 필수 필드 |
|----------|----------|
| 자동차등록증 | 차량번호/등록번호, 소유자/성명 |
| 자동차세 완납증명서 | 납세자/성명 |
| 인감증명서 | 성명/본인 |
| 사업자등록증 | 상호/사업장명, 사업자등록번호 |

## 스크립트

| 명령어 | 설명 |
|--------|------|
| `npm run dev` | 개발 서버 실행 (Hot reload) |
| `npm run build` | TypeScript 빌드 |
| `npm start` | 프로덕션 서버 실행 |

## 환경 변수

현재 하드코딩된 값들을 환경 변수로 분리할 수 있습니다:

```bash
# .env (예시)
PORT=3001
OCR_API_URL=https://ganada0037--ocr-serverless-split-ocrservice-analyze-dev.modal.run
PRICE_API_URL=https://xgltqfyf77.execute-api.ap-northeast-2.amazonaws.com/predict
```

## 관련 프로젝트

- [prototype-fe](../prototype-fe) - 프론트엔드

