# SCNU DT

### [바로가기]
- [준비물](#준비물)
- [설치](#설치)
- [실행](#실행)
- [다른 포트로 실행](#다른-포트로-실행)
- [테스트와 빌드](#테스트와-빌드)
- [휴대폰에서 보기](#휴대폰에서-보기)
- [문제 해결](#문제-해결)
- [캠퍼스 태양광 개발 환경](#캠퍼스-태양광-개발-환경)
- [안전한 SQLite seed와 reset](#안전한-sqlite-seed와-reset)
- [가정과 계산식](#가정과-계산식)
- [End-to-end 확인 경로](#end-to-end-확인-경로)
- [기존 작업 절차](#기존-작업-절차)
  - [**중요!**](#중요)

---

## 준비물

- Python 3.11 이상
- bun 1.1 이상
- ffmpeg (선택, 녹화 영상을 비전 입력으로 쓸 때만 필요)

명령은 따로 적지 않으면 모두 저장소 루트에서 실행합니다. 아래에는 macOS/Linux용 bash 블록과 Windows용 PowerShell 블록이 짝으로 있습니다. 가상환경은 활성화하지 않고 인터프리터 경로로 바로 부릅니다.

## 설치

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

## 실행

서비스마다 터미널 창을 하나씩 씁니다.

### 1) Weather API (`127.0.0.1:8000`)

```bash
.venv/bin/python -m uvicorn api.app:app --app-dir weather --host 127.0.0.1 --port 8000
```

```powershell
.venv\Scripts\python.exe -m uvicorn api.app:app --app-dir weather --host 127.0.0.1 --port 8000
```

상태 확인: `http://127.0.0.1:8000/health`, API 문서: `http://127.0.0.1:8000/docs`

### 2) Vision API (`127.0.0.1:8001`)

`--source 0`은 기본 카메라입니다. 영상 파일 경로나 스트림 URL을 넣어도 됩니다. YOLO 가중치는 `--model <가중치 경로>`로 지정합니다.

```bash
.venv/bin/python vision_api.py --source 0 --port 8001
```

```powershell
.venv\Scripts\python.exe vision_api.py --source 0 --port 8001
```

상태 확인: `http://127.0.0.1:8001/api/traffic`

### 3) 교통 시뮬레이션 API (`127.0.0.1:8002`)

`backend` 폴더에서 실행합니다.

```bash
cd backend && ../.venv/bin/python -m uvicorn simulation.main:app --host 127.0.0.1 --port 8002
```

```powershell
cd backend; ..\.venv\Scripts\python -m uvicorn simulation.main:app --host 127.0.0.1 --port 8002
```

상태 확인: `http://127.0.0.1:8002/health`

### 4) Frontend (`127.0.0.1:5173`)

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

## 다른 포트로 실행

백엔드는 `--port`만 바꾸고, 프런트엔드에는 같은 포트를 가리키는 `VITE_*` 값을 줍니다. Vite 포트는 `--port`로 바꿉니다.

```bash
export VITE_API_URL=http://127.0.0.1:18000 && export VITE_VISION_API_URL=http://127.0.0.1:18001 && export VITE_SIMULATION_API_URL=http://127.0.0.1:18002 && export VITE_SIMULATION_WS_URL=ws://127.0.0.1:18002/ws/simulation && cd frontend && bun run dev:legacy -- --port 15173
```

```powershell
$env:VITE_API_URL="http://127.0.0.1:18000"; $env:VITE_VISION_API_URL="http://127.0.0.1:18001"; $env:VITE_SIMULATION_API_URL="http://127.0.0.1:18002"; $env:VITE_SIMULATION_WS_URL="ws://127.0.0.1:18002/ws/simulation"; cd frontend; bun run dev:legacy -- --port 15173
```

## 테스트와 빌드

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

## 휴대폰에서 보기

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

## 문제 해결

- **날씨 패널이 늦거나 비어 있음:** 기상청·에어코리아 호출이 느리거나 실패한 경우입니다. 이전 응답이 있으면 캐시된 값을 보여 주고, 없으면 API가 503과 안내 메시지를 돌려줍니다. 지도와 건물 팝업은 그대로 동작합니다.
- **VWorld 지도가 안 뜸:** `frontend/.env`의 `VITE_VWORLD_API_KEY`가 비었거나, 접속한 호스트가 키에 등록되지 않은 경우입니다.
- **Vision API가 모델을 못 찾음:** YOLO 가중치는 저장소에 없습니다(gitignore). 따로 받아 두고 `--model`로 경로를 넘기세요. 첫 실행은 모델과 카메라를 여느라 느립니다.
- **자동차 비전 데모(`car_vision_model/`):** 대시보드와 별개 데모라서 8003 포트를 씁니다. 8001의 대시보드 Vision API와 겹치지 않게 하세요.

---

## 캠퍼스 태양광 개발 환경

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

## 안전한 SQLite seed와 reset

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

## 가정과 계산식

모든 소비량은 계측값이 아니라 15분 단위 **가상 예측**이다. 기상 preset은 **시나리오/추정**이며 공학 보정값이 아니다.

- 기본 대기 부하(kW): 강의실 0.20, 컴퓨터실 0.80, 실험실 1.00, 교수실 0.40, 서버실 6.00.
- 점유 시 조명(kW): 소/중/대 0.60/1.00/1.50. 일반 plug 부하(kW): 강의실 0.40, 컴퓨터실 0.80, 실험실 2.00, 교수실 0.80.
- 컴퓨터 0.15 kW/대, 대형 화면 0.30 kW, 점유 HVAC 2.50 kW/대, 서버 HVAC 상시 1.25 kW/대.
- 모듈: 1.05 m x 2.10 m, 효율 20%, 정격 441 Wp, 패널 간격 0.02 m. 옥상 가장자리 0.50 m, 장애물 1.00 m 이격.
- 발전량: `용량(kWp) x 경사면 일사량(kWh/m2) x 온도계수 x (1 - 시스템손실) x 음영계수`; 기본 시스템 손실은 10%이고 각 곱셈 계수는 0..1로 제한한다.
- 직접사용량 `min(발전, 수요)`, 계통수전 `max(수요 - 발전, 0)`, 잉여 `max(발전 - 수요, 0)`, 자급률 `직접사용 / 수요`, 태양광 활용률 `직접사용 / 발전`이다. 일/월 비율은 구간 비율 평균이 아니라 에너지 합계로 계산한다.
- 절감액은 기본 160 KRW/kWh를 사용한다. 비용·탄소 결과는 화면/API에 명시된 configurable 가정이 있을 때만 계산값으로 해석하며 계측값으로 보지 않는다. 캠퍼스 순위는 같은 날짜와 같은 결정적 기상 preset만 비교하고 365일 연환산, 1800 kWh/kWp 기준과 화면에 표시된 가중치를 사용한다.

## End-to-end 확인 경로

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

## 기존 작업 절차
절차 등 **branch**를 나눠서 작업할 예정입니다.  
<br>
#### **중요!**
* **기능 추가는 Pull requests 기능을 이용하세요! 한 파일을 다수가 동시에 수정하면 안됩니다!**
* `main` 브랜치는 현재 상태로 유지합니다. 배포할 소스코드만 업로드합니다.
* 모든 작업은 이 브랜치(`dev`)에서 끝납니다. Merge, push, commit 등 모든 액션에서 확인 후 시작하세요!
* 이 Repository는 공개되지 않습니다. 종료 전까지 공개하지 않을 예정이오나 사업단 또는 그 외 증빙이 필요할 경우 공개될 수 있습니다.
---

1. 로컬 동기화: 작업 시작 전 원격 `dev` 브랜치의 최신 상태를 로컬로 가져옴
```
```
2. 기능 브랜치(Feature Branch) 생성: 각 작업자는 `dev` 브랜치에서 분기하여 독립적인 작업 브랜치 생성.
- 명명 규칙(`feature/login`, `feature/api-setup`) 적용.
```
```
3. 독립 작업 및 커밋: 할당된 기능 구현 후 로컬 환경에 커밋.
```
```
4. 원격 푸시: 작업이 완료된 기능 브랜치를 원격 저장소에 업로드.
```
```
5. Pull Request (PR) 생성: GitHub 웹 인터페이스에서 작업 브랜치(`feature/작업명`)를 타겟 브랜치(`dev`)로 병합(Merge)해달라고 요청.
6. 코드 리뷰 및 병합: 팀원 검토 후 이상이 없으면 `dev`으로 병합. 병합 완료 후 원격 및 로컬의 `feature` 브랜치 삭제.
7. 사이클 반복: 새로운 기능 개발 시 1번 단계부터 다시 수행.

동시 작업 충돌(Conflict) 통제 원칙
* 작업 단위 분리: 개발자 간 동일 파일 수정이 겹치지 않도록 기능 및 컴포넌트 단위를 명확히 분할.
* 주기적 동기화: 작업 기간이 길어질 경우, 원격 `dev`에 업데이트된 다른 팀원의 코드를 자신의 `feature` 브랜치로 수시로 병합하여 릴리스 직전의 대규모 충돌 방지.
```
```
* **로컬 충돌 해결:** PR 생성 전 로컬 환경에서 발생하는 충돌을 먼저 해결한 뒤 원격에 반영.
