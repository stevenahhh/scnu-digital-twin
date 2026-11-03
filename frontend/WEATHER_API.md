# 날씨/미기후 API 연동 가이드 (프론트엔드용)

> **담당**: weather 팀  
> **기준 서버**: `http://localhost:8000` (개발) / 배포 주소는 별도 공유  
> **최종 수정**: 2026-10-16

---

## 1. 건물 클릭 팝업 — 핵심 엔드포인트

```
GET /microclimate/elements/{element_id}/popup
```

3D 뷰에서 **건물을 클릭하면 이것 하나만 호출**하면 됩니다.  
팝업에 필요한 모든 정보가 담겨 있어서 추가 API 호출 불필요합니다.

### 예시 요청

```
GET http://localhost:8000/microclimate/elements/BLD_D2/popup
```

### 응답 예시

```json
{
  "element_id": "BLD_D2",
  "name": "공과대학 1호관",
  "zone_id": "zone_D",
  "element_type": "building",
  "timestamp": "20260429T1200",

  "data_note": {
    "assumption_level": "estimated",
    "material_source": "estimated_surface_library_v1",
    "message": "현재 재질/복사 정보는 추정 기반 시뮬레이션 값이며, 추후 실측/정밀 모델로 교체될 수 있습니다."
  },

  "thermal": {
    "local_temp": 34.8,
    "feels_like": 39.1,
    "utci": 41.3,
    "wbgt": 32.7,
    "risk_level": "매우 높음",
    "stress_category": "매우 강한 열 스트레스",
    "risk_color": "#F57C00",
    "risk_score": 3
  },

  "factors": {
    "shade": { "level": "낮음", "value": 0.143 },
    "vegetation": { "level": "낮음", "value": 0.073 },
    "wind":       { "level": "보통", "value": 0.631 },
    "radiation":  { "level": "보통", "value": 0.537 },
    "material_heat": { "level": "높음", "value": 0.71 }
  },

  "material": {
    "surface_type": "concrete",
    "albedo": 0.22,
    "surface_emissivity": 0.91,
    "thermal_conductivity": 1.35,
    "volumetric_heat_capacity": 2050000,
    "moisture_availability": 0.04
  },

  "delta": {
    "temp": 2.8,
    "utci": 7.3,
    "label": "기준 기온 대비 +2.8°C"
  },

  "reasons": [
    "기온 34.8°C, 높은 기온 (추정)",
    "복사열 과부하 (+18°C), 직달 일사가 매우 강함 (추정)",
    "습도 65%, 높아 체감 더위 증가 (추정)",
    "WBGT 32.7°C, 야외 격렬한 활동 자제 권고 (추정)"
  ],

  "base_weather": {
    "temperature": 32.0,
    "humidity": 65.0,
    "wind_speed": 2.0
  },

  "freshness": {
    "weather": {
      "source": "live",
      "observed_at": "2026-04-29T12:00:00+09:00",
      "fetched_at": "2026-04-29T12:04:10+09:00",
      "age_seconds": 35,
      "stale": false
    },
    "forecast": null,
    "air_quality": null
  }
}
```

---

## 2. 응답 필드 상세 설명

### `data_note` — 현재 데이터의 성격

현재 복사/재질 정보는 **실측이 아닌 추정 기반 시뮬레이션 입력값**일 수 있습니다.
프론트는 이 값을 사용자에게 그대로 보여줄 수 있지만, 필요 시 "예상치" 또는 "시뮬레이션 값" 배지를 함께 표시하는 것을 권장합니다.

### `thermal` — 열환경 수치

| 필드              | 타입   | 설명                                                      |
| ----------------- | ------ | --------------------------------------------------------- |
| `local_temp`      | float  | 이 건물의 국지 기온 (°C) — 기준 기상 + 미기후 보정값      |
| `feels_like`      | float  | 체감온도 (°C) — Heat Index 또는 Wind Chill                |
| `utci`            | float  | UTCI 열 스트레스 지수 (°C 단위, 사람 체감 기준)           |
| `wbgt`            | float  | WBGT 열 위험 지수 (°C 단위, 운동/야외활동 기준)           |
| `risk_level`      | string | 위험 등급 텍스트 (아래 표 참고)                           |
| `stress_category` | string | 위험 등급 설명 문장                                       |
| `risk_color`      | string | **위험 등급 hex 색상** → 직접 CSS/Three.js 에 사용 가능   |
| `risk_score`      | int    | **위험 등급 정수 (0~4)** → 색상 그라디언트·진행 바에 사용 |

#### 위험 등급 매핑표

| `risk_level` | `risk_score` | `risk_color`     | UTCI 범위  |
| ------------ | ------------ | ---------------- | ---------- |
| 낮음         | 0            | `#1976D2` (파랑) | 9 ~ 26 °C  |
| 주의         | 1            | `#388E3C` (초록) | 26 ~ 32 °C |
| 높음         | 2            | `#FBC02D` (노랑) | 32 ~ 38 °C |
| 매우 높음    | 3            | `#F57C00` (주황) | 38 ~ 46 °C |
| 위험         | 4            | `#D32F2F` (빨강) | 46 °C 이상 |

---

### `factors` — 미기후 인자 정성 평가

건물 주변 환경 특성을 4가지로 요약합니다.  
각 항목은 `level`(텍스트)과 `value`(0~1 원시값) 두 가지를 내려줍니다.

| 인자 | 설명 | level 낮음 기준 | level 높음 기준 |
|---|---|---|---|
| `shade` | 그늘 비율 — 높을수록 시원함 | < 0.15 | ≥ 0.35 |
| `vegetation` | 녹지 비율 — 높을수록 냉각 효과 | < 0.15 | ≥ 0.35 |
| `wind` | 통풍 계수 — 높을수록 바람 잘 통함 | < 0.45 | ≥ 0.65 |
| `radiation` | 하늘 노출도 — 높을수록 복사 노출 큼 | < 0.45 | ≥ 0.65 |
| `material_heat` | 재질 열저장 경향 — 높을수록 열이 오래 남음 | < 0.35 | ≥ 0.55 |

`level` 값: `"낮음"` / `"보통"` / `"높음"` / `"매우 높음"` 네 가지입니다.

---

### `delta` — 캠퍼스 기준 대비 차이

| 필드    | 설명                                                       |
| ------- | ---------------------------------------------------------- |
| `temp`  | 이 건물 local_temp - 현재 기준 기상 온도 (양수 = 더 더움)  |
| `utci`  | 이 건물 UTCI - 캠퍼스 평균 UTCI (있을 경우)                |
| `label` | 사람이 읽을 수 있는 텍스트 (예: `"기준 기온 대비 +2.8°C"`) |

---

### `reasons` — 원인 설명 배열

팝업 하단에 그대로 출력하면 됩니다.  
최소 1개, 보통 2~4개의 문자열 배열입니다.  
모든 문자열은 시뮬레이션 추정이라는 표시로 ` (추정)` 으로 끝납니다. 접미사는 한 번만 붙으니 프런트에서 다시 붙이지 마세요.

---

### `freshness` — 기상 입력의 신선도

`/microclimate/*`, `/environment/*` 의 모든 200 응답에 붙는 추가 필드입니다. 기존 필드는 그대로입니다.

```text
freshness = {
  "weather":     F,
  "forecast":    F | null,
  "air_quality": F | {"stale": true, "error": <kind>} | null
}
F = {"source": "live" | "cache", "observed_at": ISO8601 | null,
     "fetched_at": ISO8601, "age_seconds": int, "stale": bool}
```

- `forecast`, `air_quality` 는 그 경로가 해당 데이터를 쓰지 않으면 `null` 입니다.
- `age_seconds` 는 `observed_at` 이 아니라 `fetched_at` 기준으로 잽니다.
- `source: "cache"` 나 `stale: true` 이면 `저장된 기상 데이터 표시 중` 상태로 보고 `마지막 정상 수신 HH:mm` 을 값 옆에 보여 줍니다.
- 샘플 피처로 만든 응답(개발용 fallback)에는 `"sample_data": true` 가 붙습니다. 이때는 `샘플 데이터` 라벨을 표시하고 관측값처럼 다루지 마세요.

---

### `base_weather` — 기준 기상 요약

KMA API에서 받아온 현재 기상값입니다.  
팝업 구석에 "현재 날씨" 섹션으로 참고용으로 표시할 수 있습니다.

---

## 3. 그 외 사용 가능한 엔드포인트

### 히트맵 렌더링용 (전체 건물 한 번에)

```
GET /microclimate/heatmap
```

모든 element의 `element_id`, `zone_id`, `utci`, `wbgt`, `risk_level` 을 배열로 반환합니다.  
3D 뷰 로드 시 초기 색상 칠하기에 사용하세요.

```json
{
  "timestamp": "20260429T1200",
  "heatmap": [
    { "element_id": "BLD_D2", "zone_id": "zone_D", "utci": 41.3, "wbgt": 32.7, "risk_level": "매우 높음" },
    { "element_id": "BLD_B5", "zone_id": "zone_B", "utci": 29.6, "wbgt": 24.1, "risk_level": "주의" },
    ...
  ]
}
```

### Zone별 집계 (구역 단위 색상용)

```
GET /microclimate/zones
```

zone 단위로 평균 기온·UTCI·WBGT, 최고 위험도를 반환합니다.

---

## 4. element_id 규칙

`common/data/common_elemetns.json` 파일 기준입니다.

| 접두사 | 의미                  | 예시               |
| ------ | --------------------- | ------------------ |
| `BLD_` | 건물 (building)       | `BLD_E1` (학생회관), `BLD_D2` (공과대학 1호관) |
| `RD_`  | 도로 (road)           | `RD_011`           |
| `ND_`  | 교차로/노드 (node)    | `ND_006`           |
| `CW_`  | 인도/보도 (crosswalk) | `CW_003`           |

현재 미기후 데이터가 채워진 것은 **BLD\_\* (건물 49개)** 입니다.  
RD/ND/CW 는 null이므로 클릭 시 팝업 처리 예외 처리 필요합니다.

---

## 5. 에러 처리

| HTTP 코드 | 의미 | 대응 |
| --------- | ---- | ---- |
| `404` | element_id 없음 | 팝업 미표시 또는 "데이터 없음" 메시지 |
| `503` | 쓸 수 있는 기상 데이터가 없음 (아래 본문) | `Retry-After` 이후 재시도, `다시 시도` 버튼 |
| `500` | 예상하지 못한 서버 오류 | `서버 내부 오류가 발생했습니다` 표시 |

### 503 응답 형식

`/microclimate/*`, `/environment/*` 경로는 실시간 데이터도 쓸 만한 캐시도 없을 때 HTTP 503 과 `Retry-After: 60` 헤더를 돌려줍니다.

```json
{
  "detail": {
    "code": "weather_upstream_unavailable",
    "source": "kma_current",
    "reason": "timeout",
    "message_ko": "기상청 응답 지연으로 최신 기상 데이터를 가져오지 못했습니다",
    "message_en": "Weather upstream unavailable",
    "retry_after_s": 60
  }
}
```

| 필드 | 값 |
|---|---|
| `code` | `weather_upstream_unavailable` (기상청/에어코리아 응답 실패) 또는 `weather_api_key_missing` (`KMA_SERVICE_KEY` 미설정) |
| `source` | `kma_current`, `kma_forecast`, `airkorea` 중 하나 |
| `reason` | 실패 종류 (UpstreamError.kind) |
| `message_ko` | unavailable: `기상청 응답 지연으로 최신 기상 데이터를 가져오지 못했습니다` / key missing: `기상 API 키가 설정되지 않았습니다 (KMA_SERVICE_KEY)` |
| `retry_after_s` | 60 |

`message_en` 은 영어 안내 문구이고 예시의 값은 설명용입니다. 알 수 없는 element_id 는 여전히 404 입니다. 에너지 경로는 이 형식을 쓰지 않습니다.

### 500 응답 형식

원본 예외 문자열은 내려가지 않습니다.

```json
{"detail": {"code": "internal_error", "message_ko": "서버 내부 오류가 발생했습니다", "message_en": "Internal server error"}}
```

### 대표 설치 계획 경로

에너지 패널의 대표 설치 계획은 `/docs` 에 나오는 정식 경로를 씁니다.

```text
GET    /energy/buildings/{building_id}/representative-plan
PUT    /energy/buildings/{building_id}/representative-plan
DELETE /energy/buildings/{building_id}/representative-plan
```

대표 계획이 아직 없으면 GET 이 404 와 `representative_installation_plan_not_found` 코드를 돌려줍니다. 이건 오류가 아니라 "계획 없음" 신호이니 빈 상태로 처리하세요. 숨김 별칭 `/representative-installation-plan` 은 쓰지 않습니다.

---

## 6. 빠른 시작 예시 (JavaScript)

```javascript
async function fetchBuildingPopup(elementId) {
  const res = await fetch(
    `http://localhost:8000/microclimate/elements/${elementId}/popup`,
  );
  if (!res.ok) return null;
  return await res.json();
}

// 사용 예
const data = await fetchBuildingPopup("BLD_D2");

// 색상 직접 사용
buildingMesh.material.color.set(data.thermal.risk_color);

// 텍스트 렌더링
console.log(
  `${data.name} — ${data.thermal.risk_level} (UTCI ${data.thermal.utci}°C)`,
);
console.log(data.delta.label); // "기준 기온 대비 +2.8°C"
console.log(data.reasons.join("\n")); // 원인 설명
```

### `material` — 재질/물리 입력 요약

현재 단계에서는 건물/도로 재질이 적용되어 있다고 **가정**한 시뮬레이션 입력입니다.
향후 실제 재질 데이터가 연결되면 값이 바뀔 수 있습니다.

| 필드 | 설명 |
|---|---|
| `surface_type` | 표면 재질 타입 (`asphalt`, `concrete`, `grass`, `glass` 등) |
| `albedo` | 반사율 |
| `surface_emissivity` | 표면 방사율 |
| `thermal_conductivity` | 열전도율 추정치 |
| `volumetric_heat_capacity` | 체적 열용량 추정치 |
| `moisture_availability` | 수분 이용 가능도 / 증발냉각 잠재치 |
