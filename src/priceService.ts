import axios from 'axios';
import type { VehicleInfo, PricePrediction, PriceFactor } from './types.js';

const PRICE_API_URL = 'https://xgltqfyf77.execute-api.ap-northeast-2.amazonaws.com/predict';

// 차량 정보를 API 형식으로 변환
function convertVehicleInfoToApiFormat(vehicleInfo: VehicleInfo): Record<string, unknown> {
  // 디버깅: 입력값 확인
  console.log('Input vehicleInfo:', {
    distance: vehicleInfo.distance,
    displacement: vehicleInfo.displacement,
    newPrice: vehicleInfo.newPrice,
    ageMonths: vehicleInfo.ageMonths,
  });

  // API 필드명이 log_distance이지만, 실제로는 원래 값을 그대로 전달
  // (API 내부에서 로그 변환을 수행하는 것으로 추정)
  return {
    model_name: vehicleInfo.modelName,
    age_text: vehicleInfo.ageMonths,
    log_distance: vehicleInfo.distance,
    log_displacement: vehicleInfo.displacement,
    fuel:
      vehicleInfo.fuel === 'diesel'
        ? '디젤'
        : vehicleInfo.fuel === 'gasoline'
        ? '가솔린'
        : vehicleInfo.fuel === 'electric'
        ? '전기'
        : vehicleInfo.fuel === 'hybrid'
        ? '하이브리드'
        : 'LPG',
    color:
      vehicleInfo.color === 'black'
        ? '검정'
        : vehicleInfo.color === 'white'
        ? '흰색'
        : vehicleInfo.color === 'gray'
        ? '회색'
        : '기타',
    new_price: vehicleInfo.newPrice,
    sunroof: vehicleInfo.sunroof ? 1 : 0,
    panorama_sunroof: vehicleInfo.panoramaSunroof ? 1 : 0,
    front_seat_heater: vehicleInfo.frontSeatHeater ? 1 : 0,
    rear_seat_heater: vehicleInfo.rearSeatHeater ? 1 : 0,
    rear_sensor: vehicleInfo.rearSensor ? 1 : 0,
    rear_camera: vehicleInfo.rearCamera ? 1 : 0,
    around_view: vehicleInfo.aroundView ? 1 : 0,
    navigation: vehicleInfo.navigation ? 1 : 0,
    owner_change_bin: vehicleInfo.ownerChange,
    major_defect_bin: vehicleInfo.majorDefect,
    minor_defect_bin: vehicleInfo.minorDefect,
  };
}

// 가격 요인 분석
function analyzePriceFactors(vehicleInfo: VehicleInfo): PriceFactor[] {
  const factors: PriceFactor[] = [];

  // 주행거리 분석
  if (vehicleInfo.distance < 50000) {
    factors.push({
      name: '주행거리',
      impact: 'positive',
      description: '주행거리가 적어 차량 상태가 양호합니다.',
    });
  } else if (vehicleInfo.distance > 150000) {
    factors.push({
      name: '주행거리',
      impact: 'negative',
      description: '주행거리가 많아 가격에 영향을 줍니다.',
    });
  } else {
    factors.push({
      name: '주행거리',
      impact: 'neutral',
      description: '평균적인 주행거리입니다.',
    });
  }

  // 차량 연식 분석
  if (vehicleInfo.ageMonths < 36) {
    factors.push({
      name: '차량 연식',
      impact: 'positive',
      description: '3년 이하의 신형 차량입니다.',
    });
  } else if (vehicleInfo.ageMonths > 84) {
    factors.push({
      name: '차량 연식',
      impact: 'negative',
      description: '7년 이상 된 차량으로 연식 감가가 적용됩니다.',
    });
  } else {
    factors.push({
      name: '차량 연식',
      impact: 'neutral',
      description: '적정 연식의 차량입니다.',
    });
  }

  // 소유자 변경 횟수
  if (vehicleInfo.ownerChange === '0') {
    factors.push({
      name: '소유자 변경',
      impact: 'positive',
      description: '첫 번째 소유자 차량으로 이력이 깔끔합니다.',
    });
  } else if (vehicleInfo.ownerChange === '3+') {
    factors.push({
      name: '소유자 변경',
      impact: 'negative',
      description: '소유자 변경이 많아 가격에 영향을 줍니다.',
    });
  }

  // 주요 결함
  if (vehicleInfo.majorDefect === 'high(11+)') {
    factors.push({
      name: '주요 결함',
      impact: 'negative',
      description: '주요 결함이 다수 발견되었습니다.',
    });
  } else if (vehicleInfo.majorDefect === 'low(0-2)') {
    factors.push({
      name: '주요 결함',
      impact: 'positive',
      description: '주요 결함이 거의 없는 양호한 상태입니다.',
    });
  }

  // 경미한 결함
  if (vehicleInfo.minorDefect === 'high(16+)') {
    factors.push({
      name: '경미한 결함',
      impact: 'negative',
      description: '외관 및 내장 결함이 다수 있습니다.',
    });
  }

  // 프리미엄 옵션
  const premiumOptions: string[] = [];
  if (vehicleInfo.panoramaSunroof) premiumOptions.push('파노라마 선루프');
  if (vehicleInfo.aroundView) premiumOptions.push('어라운드뷰');
  if (vehicleInfo.navigation) premiumOptions.push('네비게이션');

  if (premiumOptions.length > 0) {
    factors.push({
      name: '프리미엄 옵션',
      impact: 'positive',
      description: `${premiumOptions.join(', ')} 옵션이 포함되어 있습니다.`,
    });
  }

  // 브랜드
  if (vehicleInfo.modelName === 'Genesis') {
    factors.push({
      name: '브랜드',
      impact: 'positive',
      description: '제네시스 브랜드로 프리미엄 가치가 있습니다.',
    });
  }

  // 연료 타입
  if (vehicleInfo.fuel === 'electric') {
    factors.push({
      name: '연료 타입',
      impact: 'positive',
      description: '전기차로 친환경 프리미엄이 적용됩니다.',
    });
  } else if (vehicleInfo.fuel === 'hybrid') {
    factors.push({
      name: '연료 타입',
      impact: 'positive',
      description: '하이브리드 차량으로 연비 효율이 좋습니다.',
    });
  }

  return factors;
}

// 가격 예측 API 호출
export async function predictPrice(vehicleInfo: VehicleInfo): Promise<PricePrediction> {
  try {
    const apiData = convertVehicleInfoToApiFormat(vehicleInfo);
    console.log('Price API Request:', JSON.stringify(apiData, null, 2));

    const response = await axios.post(PRICE_API_URL, apiData, {
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    console.log('Price API Response:', JSON.stringify(response.data, null, 2));

    // 응답 형식 처리: 직접 {"predicted_price": ...} 또는 {"body": "{...}"} 형식 모두 지원
    let predictedPrice: number;
    if (response.data.predicted_price !== undefined) {
      // 새 형식: {"predicted_price": 71158677}
      predictedPrice = response.data.predicted_price;
    } else if (response.data.body) {
      // 이전 형식: {"statusCode": 200, "body": "{\"predicted_price\": 21736580}"}
      const bodyData = typeof response.data.body === 'string'
        ? JSON.parse(response.data.body)
        : response.data.body;
      predictedPrice = bodyData.predicted_price;
    } else {
      throw new Error('Unexpected API response format');
    }

    // 가격 범위 계산 (예측가의 ±5%)
    const margin = predictedPrice * 0.05;
    const priceRange = {
      min: Math.round(predictedPrice - margin),
      max: Math.round(predictedPrice + margin),
    };

    // 가격 요인 분석
    const factors = analyzePriceFactors(vehicleInfo);

    return {
      predictedPrice: Math.round(predictedPrice),
      priceRange,
      factors,
    };
  } catch (error: any) {
    console.error('Price prediction API error:', error?.response?.status, error?.message);

    // API 실패 시 간단한 추정 로직
    const basePrice = vehicleInfo.newPrice;
    const depreciationRate = 0.15; // 연간 감가상각률 15%
    const years = vehicleInfo.ageMonths / 12;

    // 주행거리에 따른 추가 감가
    let distanceDepreciation = 0;
    if (vehicleInfo.distance > 100000) {
      distanceDepreciation = 0.05;
    } else if (vehicleInfo.distance > 150000) {
      distanceDepreciation = 0.1;
    }

    // 소유자 변경에 따른 추가 감가
    let ownerDepreciation = 0;
    if (vehicleInfo.ownerChange === '1') ownerDepreciation = 0.02;
    else if (vehicleInfo.ownerChange === '2') ownerDepreciation = 0.04;
    else if (vehicleInfo.ownerChange === '3+') ownerDepreciation = 0.06;

    // 옵션에 따른 가치 추가
    let optionBonus = 0;
    if (vehicleInfo.panoramaSunroof) optionBonus += 0.01;
    if (vehicleInfo.aroundView) optionBonus += 0.01;
    if (vehicleInfo.navigation) optionBonus += 0.005;

    const totalDepreciation = Math.pow(1 - depreciationRate, years) * (1 - distanceDepreciation - ownerDepreciation) * (1 + optionBonus);
    const estimatedPrice = Math.round(basePrice * totalDepreciation);
    const margin = estimatedPrice * 0.1;

    const isApiStopped = error?.response?.status === 404 ||
                         error?.message?.includes('stopped') ||
                         error?.code === 'ECONNREFUSED';

    return {
      predictedPrice: estimatedPrice,
      priceRange: {
        min: Math.round(estimatedPrice - margin),
        max: Math.round(estimatedPrice + margin),
      },
      factors: [
        {
          name: '간이 추정가',
          impact: 'neutral',
          description: isApiStopped
            ? 'AI 예측 API가 현재 중지 상태입니다. 간이 계산식으로 추정한 가격입니다.'
            : 'API 연결 오류로 간이 계산식으로 추정한 가격입니다.',
        },
        ...analyzePriceFactors(vehicleInfo),
      ],
    };
  }
}
