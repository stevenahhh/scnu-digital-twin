<div align="center">

# SCNU Digital Twin

**국립순천대학교 캠퍼스 디지털 트윈** · 3D 캠퍼스 모델 위에 기상·미기후, 교통, 에너지(태양광) 데이터를 한 화면에 모은 대시보드

[![frontend](https://img.shields.io/badge/frontend-React%2018%20%C2%B7%20Three.js%20%C2%B7%20Vite-61dafb?logo=react&logoColor=white)](frontend/)
[![backend](https://img.shields.io/badge/backend-FastAPI%20%C2%B7%20Python%203.11-009688?logo=fastapi&logoColor=white)](weather/)
[![runtime](https://img.shields.io/badge/runtime-bun%201.1%2B-f9f1e1?logo=bun&logoColor=black)](https://bun.sh)
[![branch](https://img.shields.io/badge/main%20branch-dev-blue)](#팀-작업-규칙)

<img src="docs/development-test-evidence/05-legacy-dashboard-campus-overview.png" alt="Legacy 대시보드 캠퍼스 조감" width="820">

</div>

## 무엇을 하는 프로젝트인가

순천대 캠퍼스를 실제 지형·건물·도로·수목까지 재현한 3D 모델 위에, 외부 데이터와 시뮬레이션 결과를 겹쳐 보여 줍니다.

| 영역 | 내용 | 위치 |
|---|---|---|
| **3D 캠퍼스 모델** | 지형(DEM), 건물 29동(층수·입면·지붕 설비), 도로·인도·연석·노면표시, 수목 2,650그루, 가로등·시설물을 공개 지리 데이터와 항공사진에서 자동 생성. 삼각형 약 100만, 19 MB GLB | `frontend/scripts/campus-model/` → `frontend/public/campus-v2.glb` |
| **대시보드(Legacy)** | Three.js 렌더러. 시각·날짜에 따른 태양 위치·그림자·단풍, 건물 선택과 상세 패널, 비교 모드, 발표 모드 | `frontend/src/AppLegacy.jsx` |
| **대시보드(VWorld)** | 같은 패널을 VWorld WebGL 지도 위에 올린 병행 엔트리 | `frontend/src/AppVWorld.jsx` |
| **기상·미기후 API** | 기상청·에어코리아 수집, 건물별 일사·풍속·복사온도 추정, 503/캐시 신선도 계약 | `weather/` (포트 8000) |
| **교통 시뮬레이션** | 보행·차량 분리 교통망 위의 에이전트 시뮬레이션, WebSocket 스트림 | `backend/simulation/` (포트 8002) |
| **영상 분석** | YOLO 기반 정문 차량 계수 | `vision_api.py` (포트 8001), `car_vision_model/` |
| **태양광·에너지** | 옥상 배열 배치 편집, 15분 단위 수요·발전 추정, 캠퍼스 순위 | `weather/energy/`, 대시보드 `에너지` 탭 |

> 모델의 높이·재질·도색과 기상·에너지 수치 상당수는 **추정값**입니다. 화면에는 `추정` 표기를 유지하고 계측값으로 해석하지 않습니다. 입력 데이터의 출처와 사용 결정은 [`docs/data-licences.md`](docs/data-licences.md)에 적어 두었습니다.

## 저장소 구조

```text
.
├── frontend/                 # 대시보드(Legacy·VWorld)와 캠퍼스 모델 생성기
│   ├── src/                  #   React 앱, 렌더링, 라벨, 조명, 시뮬레이션 오버레이
│   ├── scripts/campus-model/ #   GLB 생성 파이프라인(fetch → build → bake AO → pack)
│   ├── scripts/qa/           #   정적 검사와 시각 QA 하네스
│   └── public/               #   campus-v2.glb, 높이 사이드카, 폰트
├── weather/                  # 기상·미기후·에너지 FastAPI
├── backend/simulation/       # 교통 시뮬레이션 FastAPI + WebSocket
├── car_vision_model/         # YOLO 차량 계수 서버와 데모 클라이언트
├── TrafficSafety/            # 안전 신고 OCR/NLP PoC(Streamlit, 독립 실행)
├── common/data/              # 도메인 공통 요소 ID·지오메트리 계약
├── docs/                     # 정적 데모, 테스트 증빙, 데이터 라이선스 기록
└── vision_api.py             # 대시보드용 교통 엔드포인트
```

폴더별 상세 안내는 각 폴더의 `README.md`와 `AGENTS.md`에 있습니다. 캠퍼스 모델 생성기는 [`frontend/scripts/campus-model/README.md`](frontend/scripts/campus-model/README.md), 교통망은 [`backend/simulation/README.md`](backend/simulation/README.md)를 보세요.

## 빠른 시작

```bash
# 1) 의존성
python3 -m venv .venv && .venv/bin/python -m pip install -r weather/requirements.txt -r backend/simulation/requirements.txt -r car_vision_model/requirements_server.txt
bun install --cwd frontend
cp weather/.env.example weather/.env && cp frontend/.env.example frontend/.env   # 키 값 채우기

# 2) 서비스(터미널 하나씩)
.venv/bin/python -m uvicorn api.app:app --app-dir weather --host 127.0.0.1 --port 8000
.venv/bin/python -m uvicorn simulation.main:app --app-dir backend --host 127.0.0.1 --port 8002
bun run --cwd frontend dev:legacy        # http://127.0.0.1:5173
```

기상 API 없이도 지도와 건물 선택은 동작합니다. Vision API(8001)는 YOLO 가중치와 카메라가 있을 때만 띄우면 됩니다. Windows 명령과 포트 변경, 휴대폰 접속은 아래 상세 안내에 있습니다.

### 자주 쓰는 명령

| 할 일 | 명령 |
|---|---|
| 프런트엔드 테스트(node + vitest + 정적 검사) | `bun run --cwd frontend test` |
| Python 테스트(weather, simulation) | `.venv/bin/python -m pytest` |
| 두 엔트리 빌드 | `bun run --cwd frontend build && bun run --cwd frontend build:vworld` |
| 캠퍼스 GLB 재생성(네트워크 없음) | `bun run --cwd frontend model:build` |
| 건물·지면 AO 재굽기(지오메트리 변경 후) | `frontend/scripts/campus-model/bake/README.md` 참고 |
| 보행·차량 교통망 재생성 | `bun run --cwd frontend network:build` |
| 원본 모델과 비교 | 대시보드를 `?model=uni`로 열기 |

---

<details>
<summary><b>상세 설치·실행 안내</b> (macOS/Linux와 Windows 짝, 포트 변경, 휴대폰, 문제 해결, 태양광 개발 환경)</summary>

### 준비물

- Python 3.11 이상
- bun 1.1 이상
- ffmpeg (선택, 녹화 영상을 비전 입력으로 쓸 때만 필요)

명령은 따로 적지 않으면 모두 저장소 루트에서 실행합니다. 아래에는 macOS/Linux용 bash 블록과 Windows용 PowerShell 블록이 짝으로 있습니다. 가상환경은 활성화하지 않고 인터프리터 경로로 바로 부릅니다.

### 설치

저장소 루트에 `.venv` 하나를 만들고 세 서비스의 의존성을 함께 설치합니다.

```bash
python3 -m venv .venv && .venv/bin/python -m pip install -r weather/requirements.txt -r backend/simulation/requirements.txt -r car_vision_model/requirements_server.txt
```

```powershell
py -m venv .venv; .venv\Scripts\python.exe -m pip install -r weather\requirements.txt -r backend\simulation\requirements.txt -r car_vision_model\requirements_server.txt
```

환경 파일은 예시를 복사한 뒤 값을 채웁니다. 키 값은 커밋하지 마세요.

```bash
cp weather/.env.example weather/.env && cp frontend/.env.example frontend/.env
```

```powershell
cp weather\.env.example weather\.env; cp frontend\.env.example frontend\.env
```

- `weather/.env`: 기상청(KMA), 에어코리아 키
- `frontend/.env`: `VITE_VWORLD_API_KEY`(VWorld 모드), `VITE_API_URL`, `VITE_VISION_API_URL`, `VITE_SIMULATION_API_URL`, `VITE_SIMULATION_WS_URL`

### 실행

서비스마다 터미널 창을 하나씩 씁니다.

#### 1) Weather API (`127.0.0.1:8000`)

```bash
.venv/bin/python -m uvicorn api.app:app --app-dir weather --host 127.0.0.1 --port 8000
```

```powershell
.venv\Scripts\python.exe -m uvicorn api.app:app --app-dir weather --host 127.0.0.1 --port 8000
```

상태 확인: `http://127.0.0.1:8000/health`, API 문서: `http://127.0.0.1:8000/docs`

#### 2) Vision API (`127.0.0.1:8001`)

`--source 0`은 기본 카메라입니다. 영상 파일 경로나 스트림 URL을 넣어도 됩니다. YOLO 가중치는 `--model <가중치 경로>`로 지정합니다.

```bash
.venv/bin/python vision_api.py --source 0 --port 8001
```

```powershell
.venv\Scripts\python.exe vision_api.py --source 0 --port 8001
```

상태 확인: `http://127.0.0.1:8001/api/traffic`

#### 3) 교통 시뮬레이션 API (`127.0.0.1:8002`)

`backend` 폴더에서 실행합니다.

```bash
cd backend && ../.venv/bin/python -m uvicorn simulation.main:app --host 127.0.0.1 --port 8002
```

```powershell
cd backend; ..\.venv\Scripts\python -m uvicorn simulation.main:app --host 127.0.0.1 --port 8002
```

상태 확인: `http://127.0.0.1:8002/health`

분리 교통망(인도·횡단보도/차도) 재생성: `bun run --cwd frontend network:build` (자세한 내용과 60초 분리 검증은 `backend/simulation/README.md` "보행/차량 분리 교통망").

#### 4) Frontend (`127.0.0.1:5173`)

`frontend` 폴더에서 실행합니다. Legacy(Three.js)와 VWorld는 별개 엔트리입니다.

```bash
cd frontend && bun install && bun run dev:legacy
```

```powershell
cd frontend; bun install; bun run dev:legacy
```

VWorld 모드:

```bash
cd frontend && bun install && bun run dev:vworld
```

```powershell
cd frontend; bun install; bun run dev:vworld
```

Legacy는 `http://127.0.0.1:5173`, VWorld는 `http://127.0.0.1:5173/index-vworld.html`에서 엽니다. 건물을 누르면 `BLD_*` 팝업이 열리고, D4(공과대학 3호관)는 좌표 마커로 표시됩니다.

### 다른 포트로 실행

백엔드는 `--port`만 바꾸고, 프런트엔드에는 같은 포트를 가리키는 `VITE_*` 값을 줍니다. Vite 포트는 `--port`로 바꿉니다.

```bash
export VITE_API_URL=http://127.0.0.1:18000 && export VITE_VISION_API_URL=http://127.0.0.1:18001 && export VITE_SIMULATION_API_URL=http://127.0.0.1:18002 && export VITE_SIMULATION_WS_URL=ws://127.0.0.1:18002/ws/simulation && cd frontend && bun run dev:legacy -- --port 15173
```

```powershell
$env:VITE_API_URL="http://127.0.0.1:18000"; $env:VITE_VISION_API_URL="http://127.0.0.1:18001"; $env:VITE_SIMULATION_API_URL="http://127.0.0.1:18002"; $env:VITE_SIMULATION_WS_URL="ws://127.0.0.1:18002/ws/simulation"; cd frontend; bun run dev:legacy -- --port 15173
```

### 테스트와 빌드

프런트엔드 테스트:

```bash
cd frontend && bun run test
```

```powershell
cd frontend; bun run test
```

Python 테스트(저장소 루트):

```bash
.venv/bin/python -m pytest
```

```powershell
.venv\Scripts\python.exe -m pytest
```

빌드는 두 엔트리 모두 통과해야 합니다.

```bash
cd frontend && bun run build && bun run build:vworld
```

```powershell
cd frontend; bun run build; bun run build:vworld
```

### 휴대폰에서 보기

PC와 휴대폰이 같은 Wi-Fi에 있어야 합니다. 백엔드는 `--host 0.0.0.0`으로 띄우고, 프런트엔드는 PC의 LAN IP를 가리키게 합니다. `<LAN IP>`는 PC 주소(예: 192.168.0.10)로 바꾸세요.

```bash
.venv/bin/python -m uvicorn api.app:app --app-dir weather --host 0.0.0.0 --port 8000
```

```powershell
.venv\Scripts\python.exe -m uvicorn api.app:app --app-dir weather --host 0.0.0.0 --port 8000
```

Vision API는 기본값이 `--host 0.0.0.0`이라 그대로 두고, 시뮬레이션은 같은 방식으로 띄웁니다.

```bash
cd backend && ../.venv/bin/python -m uvicorn simulation.main:app --host 0.0.0.0 --port 8002
```

```powershell
cd backend; ..\.venv\Scripts\python -m uvicorn simulation.main:app --host 0.0.0.0 --port 8002
```

```bash
export VITE_API_URL="http://<LAN IP>:8000" && export VITE_VISION_API_URL="http://<LAN IP>:8001" && export VITE_SIMULATION_API_URL="http://<LAN IP>:8002" && export VITE_SIMULATION_WS_URL="ws://<LAN IP>:8002/ws/simulation" && cd frontend && bun run dev:legacy -- --host 0.0.0.0
```

```powershell
$env:VITE_API_URL="http://<LAN IP>:8000"; $env:VITE_VISION_API_URL="http://<LAN IP>:8001"; $env:VITE_SIMULATION_API_URL="http://<LAN IP>:8002"; $env:VITE_SIMULATION_WS_URL="ws://<LAN IP>:8002/ws/simulation"; cd frontend; bun run dev:legacy -- --host 0.0.0.0
```

휴대폰 브라우저에서 `http://<LAN IP>:5173`을 엽니다. VWorld 모드는 API 키가 그 호스트(LAN IP)에 등록돼 있을 때만 지도 인증을 통과합니다. 등록이 안 됐으면 Legacy 모드로 보세요.

### 문제 해결

- **날씨 패널이 늦거나 비어 있음:** 기상청·에어코리아 호출이 느리거나 실패한 경우입니다. 이전 응답이 있으면 캐시된 값을 보여 주고, 없으면 API가 503과 안내 메시지를 돌려줍니다. 지도와 건물 팝업은 그대로 동작합니다.
- **VWorld 지도가 안 뜸:** `frontend/.env`의 `VITE_VWORLD_API_KEY`가 비었거나, 접속한 호스트가 키에 등록되지 않은 경우입니다.
- **Vision API가 모델을 못 찾음:** YOLO 가중치는 저장소에 없습니다(gitignore). 따로 받아 두고 `--model`로 경로를 넘기세요. 첫 실행은 모델과 카메라를 여느라 느립니다.
- **자동차 비전 데모(`car_vision_model/`):** 대시보드와 별개 데모라서 8003 포트를 씁니다. 8001의 대시보드 Vision API와 겹치지 않게 하세요.

### 캠퍼스 태양광 개발 환경

아래 명령은 저장소 루트에서 Windows PowerShell로 실행한다. 먼저 [설치](#설치)를 마친다.

각 실행마다 다른 SQLite 파일을 선택한다. FastAPI가 처음 접근할 때 스키마와 결정적 캠퍼스 seed(D1-D4, C1, 옥상, 시간표, 기본 설치 시나리오)를 만든다.

```powershell
$RunId = [guid]::NewGuid().ToString('N')
$EnergyDbParent = (Join-Path $env:TEMP "campus-energy-$RunId")
New-Item -ItemType Directory -Path $EnergyDbParent -ErrorAction Stop | Out-Null
$EnergyDbPath = (Join-Path $EnergyDbParent 'energy.sqlite3')
$env:WEATHER_ENERGY_DB = $EnergyDbPath
.venv\Scripts\python.exe -m uvicorn api.app:app --app-dir weather --host 127.0.0.1 --port 8000
```

두 번째 PowerShell에서 Vite를 시작한다. 프런트엔드는 기본적으로 `http://127.0.0.1:8000`의 FastAPI를 사용한다.

```powershell
cd frontend; bun run dev:legacy -- --host 127.0.0.1 --port 5173 --strictPort
```

브라우저에서 `http://127.0.0.1:5173`을 연다. API 문서는 `http://127.0.0.1:8000/docs`, 상태 확인은 `http://127.0.0.1:8000/health`이다.

### 안전한 SQLite seed와 reset

- **Seed(비파괴):** `WEATHER_ENERGY_DB`가 가리키는 파일에 누락된 스키마와 built-in fixture만 추가한다. `INSERT OR IGNORE`이므로 기존 사용자 시나리오, 배열, 계산 결과를 삭제하거나 덮어쓰지 않는다.

  ```powershell
  .venv\Scripts\python.exe -c "from weather.energy.persistence import Database; import os; Database(os.environ['WEATHER_ENERGY_DB']).initialize(); print(os.environ['WEATHER_ENERGY_DB'])"
  ```

- **Reset(권장, 비파괴):** 기존 파일을 지우지 말고 새 고유 경로로 전환한 뒤 위 seed 명령을 실행한다. 이전 데이터베이스와 사용자 시나리오는 그대로 남는다.

  ```powershell
  $EnergyDbParent = (Join-Path $env:TEMP ("campus-energy-{0}" -f [guid]::NewGuid().ToString('N')))
  New-Item -ItemType Directory -Path $EnergyDbParent -ErrorAction Stop | Out-Null
  $EnergyDbPath = (Join-Path $EnergyDbParent 'energy.sqlite3')
  $env:WEATHER_ENERGY_DB = $EnergyDbPath
  .venv\Scripts\python.exe -c "from weather.energy.persistence import Database; import os; Database(os.environ['WEATHER_ENERGY_DB']).initialize(); print(os.environ['WEATHER_ENERGY_DB'])"
  ```

- **명시적 단일 시나리오 삭제:** 사용자 데이터 삭제는 실행 중인 API에서 정확한 시나리오 ID를 지정한 경우에만 수행한다. 와일드카드/전체 reset 명령은 제공하지 않는다.

  ```powershell
  Invoke-WebRequest -Method Delete -Uri 'http://127.0.0.1:8000/energy/scenarios/EXACT_SCENARIO_ID'
  ```

데이터베이스 파일을 삭제하거나 공유 DB를 reset하지 않는다. 개발/QA 종료 후 삭제가 필요하면 자신이 만든 고유 경로인지 먼저 확인한다.

### 가정과 계산식

모든 소비량은 계측값이 아니라 15분 단위 **가상 예측**이다. 기상 preset은 **시나리오/추정**이며 공학 보정값이 아니다.

- 기본 대기 부하(kW): 강의실 0.20, 컴퓨터실 0.80, 실험실 1.00, 교수실 0.40, 서버실 6.00.
- 점유 시 조명(kW): 소/중/대 0.60/1.00/1.50. 일반 plug 부하(kW): 강의실 0.40, 컴퓨터실 0.80, 실험실 2.00, 교수실 0.80.
- 컴퓨터 0.15 kW/대, 대형 화면 0.30 kW, 점유 HVAC 2.50 kW/대, 서버 HVAC 상시 1.25 kW/대.
- 모듈: 1.05 m x 2.10 m, 효율 20%, 정격 441 Wp, 패널 간격 0.02 m. 옥상 가장자리 0.50 m, 장애물 1.00 m 이격.
- 발전량: `용량(kWp) x 경사면 일사량(kWh/m2) x 온도계수 x (1 - 시스템손실) x 음영계수`; 기본 시스템 손실은 10%이고 각 곱셈 계수는 0..1로 제한한다.
- 직접사용량 `min(발전, 수요)`, 계통수전 `max(수요 - 발전, 0)`, 잉여 `max(발전 - 수요, 0)`, 자급률 `직접사용 / 수요`, 태양광 활용률 `직접사용 / 발전`이다. 일/월 비율은 구간 비율 평균이 아니라 에너지 합계로 계산한다.
- 절감액은 기본 160 KRW/kWh를 사용한다. 비용·탄소 결과는 화면/API에 명시된 configurable 가정이 있을 때만 계산값으로 해석하며 계측값으로 보지 않는다. 캠퍼스 순위는 같은 날짜와 같은 결정적 기상 preset만 비교하고 365일 연환산, 1800 kWh/kWp 기준과 화면에 표시된 가중치를 사용한다.

### End-to-end 확인 경로

1. 위의 새 고유 DB로 FastAPI와 Vite를 시작하고 `/health`가 `{"status":"ok"}`인지 확인한다.
2. 우측 패널의 `에너지` 탭에서 `건물별 태양광 추천`과 완료/불완전/시나리오 없음 상태를 확인한다.
3. `D4 공과대학 3호관 상세 보기`를 누르고 `태양광 설치`를 선택한다. 안내 카드의 옥상 로컬 좌표(m), 배열 drag, 회색 장애물 설명을 확인한다.
4. 배열을 2행 x 8열, 방위각 180도, 경사각 25도로 설정하고 저장한다. `다시 불러오기` 후 같은 값인지 확인한다.
5. 배열을 옥상 밖/계단실 쪽으로 drag한다. 빨간 preview와 한국어 제약 이유가 보이고 저장 버튼이 비활성인지 확인한다. `Esc`로 마지막 유효 배치로 돌아간다.
6. 캠퍼스 지도로 돌아가 `에너지` 탭에서 수요 `가상 예측`, 일사량 `시나리오/추정`, 96개 15분 구간 chart, KPI, 손실과 공간 유형별 수요를 확인한다.
7. 같은 날짜/맑음으로 캠퍼스 비교를 실행한다. D1/D2/D3/D4가 점수 구성요소와 함께 순위에 있고 C1은 옥상 메타데이터 누락 이유와 함께 제외되어야 한다. 각 순위 카드의 `배치 편집`으로 해당 건물 옥상을 열 수 있으며, `1위 추천을 새 시나리오로 열기`는 원본과 다른 편집 가능한 복사본을 만든다.
8. 실패 복구는 API를 중단하거나 브라우저에서 `/energy/**` 요청을 차단해 확인한다. dashboard/comparison은 오류와 `다시 시도`를 표시하고 0을 꾸며내지 않으며 편집 중 배치를 유지해야 한다. API 복구 뒤 재시도가 성공해야 한다.
9. 1440x900과 390x844에서 가로 overflow, 잘린 한국어, 겹친 편집 controls가 없는지 확인한다.

API smoke용 새 시나리오는 `POST /energy/scenarios` -> 응답의 `id` -> `POST /energy/scenarios/{id}/simulate` 순서로 호출한다. 요청 예시는 Swagger `/docs`의 `ScenarioCreate`와 `DateRequest`를 사용한다.


</details>

## 팀 작업 규칙

- **`dev`가 메인 브랜치**입니다. 모든 기능은 `dev`에서 `feature/<이름>`으로 분기해 작업하고 PR로 `dev`에 합칩니다. `main`은 배포용 소스만 올립니다.
- 한 파일을 여러 명이 동시에 고치지 않도록 작업 단위를 나누고, 작업이 길어지면 원격 `dev`를 수시로 자기 브랜치에 합쳐 충돌을 줄입니다. 충돌은 PR 전에 로컬에서 풉니다.
- PR 전에 `bun run --cwd frontend test`와 `pytest`를 돌리고, 캠퍼스 모델을 건드렸으면 `model:build`로 GLB를 다시 만들어 함께 커밋합니다.
- API 키와 `.env`는 커밋하지 않습니다. 예시 파일(`.env.example`)만 올립니다.
- Legacy와 VWorld는 병행 제품입니다. 대시보드 공통 동작을 바꾸면 두 빌드 모두 통과해야 합니다.
- 이 저장소는 비공개입니다. 사업단 증빙 등이 필요하면 공개될 수 있으니 민감한 값은 처음부터 넣지 마세요.

```bash
git checkout dev && git pull origin dev
git checkout -b feature/<작업명>
# ... 작업, 커밋 ...
git push -u origin feature/<작업명>
# GitHub에서 feature/<작업명> → dev PR 생성, 리뷰 후 머지, 브랜치 삭제
```
