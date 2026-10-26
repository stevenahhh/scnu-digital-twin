# Simulation API

이 합본의 기본 `data/routes.geojson`은 임시 데모가 아니라 팀원 버전의
`road_zones_wgs84.geojson` 92개 도로 영역에서 생성한 로컬 미터 중심선입니다.
재생성은 `backend/build_routes_from_road_zones.py`로 합니다.

SUMO 없이 동작하는 순천대학교 캠퍼스 OD/Graph 시뮬레이터입니다. 자동차, 보행자, 킥보드는 Origin과 Destination을 가진 Trip으로 이동하고, 도착·체류·다음 Trip·외부 제거 lifecycle을 거칩니다. 거리/TTC/예상 진행선 교차 기반 위험 이벤트를 WebSocket으로 보냅니다.

## 실행

의존성은 저장소 루트의 `.venv` 하나에 설치합니다. 설치 방법은 루트 `README.md`의 "설치"를 따르세요. 서버는 `backend` 폴더에서 띄웁니다(아래 명령은 저장소 루트 기준).

```bash
cd backend && ../.venv/bin/python -m uvicorn simulation.main:app --host 127.0.0.1 --port 8002
```

```powershell
cd backend; ..\.venv\Scripts\python -m uvicorn simulation.main:app --host 127.0.0.1 --port 8002
```

상태 확인: `http://127.0.0.1:8002/health`

## 테스트

시뮬레이션 테스트는 `backend/tests`에 있고 저장소 루트에서 돌립니다.

```bash
.venv/bin/python -m pytest backend/tests
```

```powershell
.venv\Scripts\python.exe -m pytest backend\tests
```

기본 업데이트 주기는 100ms이며 `SIMULATION_UPDATE_INTERVAL_MS=200`처럼 변경할 수 있습니다. Weather API가 없으면 기본 맑은 날씨로 계속 실행합니다.

```env
SIMULATION_PROVIDER=internal
WEATHER_API_URL=http://127.0.0.1:8000
```

## API

- `GET /health`
- `GET /api/simulation/status`
- `POST /api/simulation/start`, `/pause`, `/resume`, `/reset`
- `POST /api/simulation/speed`
- `POST /api/simulation/scenario`
- `GET /api/simulation/entities`, `/events`, `/statistics`
- `GET /api/simulation/agents/{agent_id}` (개별 metrics와 최근 trajectory)
- `WS /ws/simulation`

## ID 체계

도로망의 모든 요소는 `common/data/common_elemetns.json`의 ID 하나로 식별합니다(이름 철자 그대로가 계약입니다).

- `RD_###`: 도로 구간. 교내는 ND_ 교차로 사이 구간, 외곽은 OSM way 하나. 형상은 `data/road_segments.geojson`(시뮬레이션 좌표, `properties.epsg5186`에 EPSG:5186 사본).
- `ND_###`: 교차로 노드. `CW_###`: 횡단보도 폴리곤(CW_001-CW_031, 025-031은 위성영상 디지타이즈로 이름 미상).
- `SW_###`: NGII A003 인도 구간(분할 시 `_L`/`_R`). 현재는 `sidewalk_placeholders` 목록(형상 null, `ufid`)만 있고 todo 15에서 채웁니다.
- `external_ids.osm_way`: 외곽(perimeter) 구간에만 붙습니다(ODbL 1.0, © OpenStreetMap contributors). 교내 구간은 항상 null입니다.
- `external_ids.juso_rn_cd`: 도로명주소 도로구간 코드 자리(로그인 필요한 출처라 아직 비어 있음).
- 새 RD_ 번호는 기존 최댓값 다음부터 붙이고 기존 ID는 지우거나 바꾸지 않습니다(추가만).
- 생성: `cd frontend && bun scripts/campus-model/network/roadIds.mjs` (`--dry-run`은 쓰지 않고 통계만 출력). 같은 입력이면 결과가 바이트 단위로 같습니다.
- `width_m`(도로 영역 폴리곤 실측 중앙값), `lanes`(사진 황색 중앙선 기준, 없으면 1로 가정)는 모두 추정값입니다.
- `common/data/common_elemetns.json`을 바꾸면 `data/source/common_elemetns.json` 사본도 같이 갱신합니다(roadIds.mjs가 둘 다 씀).

## 좌표 데이터 주의

기본 `data/routes.geojson`은 팀의 WGS84 도로 폴리곤에서 D4 기준 로컬 미터로 변환한 파생 중심선입니다. 원본 데이터에는 작성된 중심선과 보행로 geometry가 없으므로, 실제 측량 중심선이 제공되면 같은 LineString 계약으로 교체하는 것이 더 정확합니다. 신호 위치는 선택형 `data/traffic_lights.json`에서 관리합니다.

## SUMO

TraCI를 설치한 뒤 다음 변수를 지정하면 `SumoSimulationProvider`를 선택합니다. TraCI가 없으면 import 오류 없이 내부 provider로 fallback합니다.

```env
SIMULATION_PROVIDER=sumo
SUMO_BINARY=sumo
SUMO_CONFIG_PATH=simulation/sumo/campus.sumocfg
```
