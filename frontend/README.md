## Frontend (Main + VWorld)

제품은 Main(`index.html`, Three.js)입니다. 로그인 화면이 먼저 뜨고 계정 역할에 따라 학생 화면(`src/student/AppStudent.jsx`)이나 관리자 대시보드(`src/AppMain.jsx`)가 열립니다. VWorld(`index-vworld.html`)는 기능 개발과 검수를 멈춘 엔트리입니다. 공용 코드를 바꾸면 `build:vworld`가 통과하는지만 확인합니다.

### 로그인과 역할

| 들어가는 방법 | 열리는 화면 |
|---|---|
| `게스트 · 학생 모드` 단추, 또는 학생 계정 `20239901` | 학생 화면. 지도, 건물 검색, 건물 정보, 현재 기상과 주차, D4 강의실 현황 |
| `게스트 · 관리자 모드` 단추, 또는 관리자 계정 `admin` | 관리자 대시보드. 에너지, 시뮬레이션, 비교, 발표 모드를 포함한 전체 기능 |

시제품용 계정의 비밀번호는 둘 다 `12341234`이고 비밀번호 칸은 8자리만 받습니다. 로그아웃은 지도 오른쪽 위 `더보기` 메뉴에 있습니다.

역할은 어느 화면을 열지만 정합니다. 권한은 서버가 토큰으로 확인합니다. GET은 누구에게나 열려 있고 그 밖의 요청은 관리자 토큰이 있어야 합니다. 인증 서버(weather 서비스)가 꺼져 있으면 게스트 단추는 토큰 없이 화면만 엽니다. 이때 저장 같은 쓰기를 시도하면 로그인 화면으로 돌아갑니다.

### 환경 변수

`.env.example` 을 `.env` (또는 `.env.local`)로 복사해서 씁니다. 실제 API 키는 커밋하지 마세요.

```bash
cd frontend && cp .env.example .env
```

```powershell
cd frontend; cp .env.example .env
```

| 변수 | 기본값 | 필요한 모드 | 설명 |
|---|---|---|---|
| `VITE_API_URL` | `http://127.0.0.1:8000` | 공통 | 기상·미기후·에너지 API (weather 서비스). 정식 이름입니다. |
| `VITE_WEATHER_API_URL` | 없음 | 공통 | `VITE_API_URL` 의 예전 별칭. 아직 읽긴 하지만 새 설정에는 쓰지 마세요. |
| `VITE_VISION_API_URL` | `http://127.0.0.1:8001` | 공통 | 교통 영상 분석 API (`vision_api.py`, `GET /api/traffic`). |
| `VITE_SIMULATION_API_URL` | `http://127.0.0.1:8002` | 공통 | 교통 시뮬레이션 HTTP API. |
| `VITE_SIMULATION_WS_URL` | `ws://127.0.0.1:8002/ws/simulation` | 공통 | 교통 시뮬레이션 WebSocket. |
| `VITE_VWORLD_API_KEY` | 빈 값 | VWorld | VWorld 지도 SDK 키. 없으면 VWorld 화면에 키 누락 안내가 뜹니다. |

Main은 `VITE_API_URL` 만 있어도 뜹니다. 영상 분석이나 시뮬레이션 서버가 꺼져 있으면 해당 패널만 연결 없음 상태로 표시됩니다.

### 개발 서버

```bash
cd frontend && bun install
```

```powershell
cd frontend; bun install
```

Main (`http://127.0.0.1:5173`):

```bash
cd frontend && bun run dev:main
```

```powershell
cd frontend; bun run dev:main
```

VWorld (`http://127.0.0.1:5173/index-vworld.html`):

```bash
cd frontend && bun run dev:vworld
```

```powershell
cd frontend; bun run dev:vworld
```

### 테스트와 빌드

```bash
cd frontend && bun run test && bun run build && bun run build:vworld
```

```powershell
cd frontend; bun run test; bun run build; bun run build:vworld
```

`build` 는 `dist/`, `build:vworld` 는 `dist-vworld/` 에 결과물을 만듭니다. 빌드 결과는 `bun run preview` 로 확인할 수 있습니다.

### 캠퍼스 모델 생성과 커버리지

저장소 루트에서 `bun run --cwd frontend model:build`로 모델을 생성합니다.
웹 앱의 `build`와 별개이며, 생성기는 `scripts/campus-model/.build/campus-v2.raw.glb`를
만들고 pack 단계가 `public/campus-v2.glb`로 내보냅니다. GLB는 커밋하지 않습니다.
Mac의 무거운 명령은 `/Users/gahn/.cache/scnu-heavy/scnu-heavy`로 실행합니다.

모델의 기준 입력은 건물 매핑 `data/bld-node-map.json`, 지면 `data/ground/parcels.json`,
주차 `data/ground/parking.json`, 출입구 `data/buildings/entrances.json`,
입면 `data/buildings/facades/*.json`입니다. 도로는 W4 통합 후
`data/ground/road-sections.json`과 `junctions.json`을 사용합니다.
각 경로는 `scripts/campus-model/` 기준입니다. 사진 조각과 옛 보정표는
`data/photo/evidence/`의 비교 증거로 보관하며 생성 입력과 구분합니다.

Todo 28의 빌드 QA 연결이 통합되면 매 빌드마다 `.build/qa/map-compare.json`,
`vr-bearings.json`, `invariants.json`을 기록합니다. 잔차 초과 항목의 사유와
추정 표시는 보고서에서 확인해야 합니다. 보고서가 있다는 사실만으로 정확도가 보장되지는 않습니다.

```bash
cd frontend
bun scripts/campus-model/qa/coverage.mjs
```

§20의 18행은 `qa/coverage-rows.json`에서 `.build/qa/categories.json`에 연결됩니다.
빌드는 실제 후보 GLB의 지형·수목·외곽 메시와 건물·가구 생성 기록을 집계하고,
교통 네트워크의 모든 좌표를 저장된 변환과 공통 좌표계로 각각 변환해 비교합니다.
각 행에 해당하는 검사 항목, 수량, 상태, 증거 경로가 있어야
`COVERAGE OK: 18 rows`와 종료 코드 0을 출력합니다. 파일만 있거나 범주가 누락되면
해당 행과 원인을 출력하고 1로 종료합니다.
생성 수량은 현장 측정값이 아니며 사진 정확도는 미검증으로 남깁니다.
실패·미검증 결과도 검사 기록으로 인정하지만 빈 항목이나 실행하지 않은 검사는 인정하지 않습니다.
개별 객체의 잔차 수락과 todo 28의 페인트 불변식은 기존 QA 보고서에서 별도로 확인합니다.

순천시 12 cm 항공사진은 2026-11-02 소유자 동의에 따라 교차 확인에 사용합니다.
픽셀은 로컬 `.cache/suncheon-12cm/<epoch>/`에만 두고, 파생 수치·벡터만 커밋합니다.
사진, VR 얼굴, 비교 이미지는 배포물에 넣지 않습니다. 입력 기록과 증거의 구분은
[모델 생성기 README](./scripts/campus-model/README.md), 사용 동의는
[data-licences.md](../docs/data-licences.md)의 D3을 따릅니다.

### 점검 체크리스트

- 건물을 클릭하면 오른쪽 패널이나 팝업이 뜨는지
- D4(공과대학 3호관) 좌표 마커 클릭이 동작하는지
- VWorld 모드에서 콘솔에 `vw` 객체 생성 오류가 없는지
- 기상 서버가 응답하지 않을 때 `기상 서버에 연결할 수 없습니다` 같은 상태 문구와 `다시 시도` 버튼이 보이는지

미기후 팝업 API 계약은 [WEATHER_API.md](./WEATHER_API.md) 에 정리되어 있습니다.
