// 시뮬레이션 서버가 보내는 엔진 값(backend/simulation risk_engine.py, statistics_manager.py, od_demand.json)을
// 화면 글자로 바꾼다. 모르는 값은 원문 대신 `기타`, 값이 없으면 `알 수 없음`이다.

const SAFETY_EVENT = Object.freeze({
  COLLISION: "충돌",
  UNSAFE_CROSSING: "위험 횡단",
  NEAR_MISS: "아차사고",
  SUDDEN_BRAKING: "급제동",
  VEHICLE_YIELDING: "차량 양보",
  SCOOTER_YIELDING: "킥보드 양보",
  TRAFFIC_CONFLICT: "교통 상충",
  CONFLICT: "상충",
  NONE: "없음",
});

const INTERACTION = Object.freeze({
  NONE: "없음",
  CONFLICT: "상충",
  CROSSING: "교차",
  FOLLOWING: "뒤따름",
  APPROACHING: "접근",
  BRAKING: "감속",
  AVOIDING: "회피",
  NEAR_MISS: "아차사고",
  HARD_BRAKE: "급제동",
});

const TIMELINE = Object.freeze({ ...SAFETY_EVENT, TRIP_START: "이동 시작", TRIP_END: "이동 완료", HARD_BRAKE: "급제동" });

const PREDICTION_MODEL = Object.freeze({
  route_swept_envelope: "경로 기반 예측",
  linear_velocity_envelope: "직선 속도 예측",
  linear: "직선 예측",
});

const DEMAND_PROFILE = Object.freeze({
  daytime: "주간",
  morning_arrival: "오전 등교",
  lunch: "점심",
  leaving: "하교",
});

const labeller = (map) => (value) => {
  if (value === null || value === undefined || value === "") return "알 수 없음";
  return map[value] ?? "기타";
};

export const safetyEventLabel = labeller(SAFETY_EVENT);
export const interactionLabel = labeller(INTERACTION);
export const timelineTypeLabel = labeller(TIMELINE);
export const predictionModelLabel = labeller(PREDICTION_MODEL);
export const demandProfileLabel = labeller(DEMAND_PROFILE);
