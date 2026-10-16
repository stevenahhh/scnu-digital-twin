# SCNU Digital Twin

국립순천대학교 캠퍼스 디지털 트윈 프로토타입 저장소입니다.

## VWorld 렌더러 전환 요약 (`dev-vw`)

- 기존 `dev`의 시뮬레이션/대시보드/미기후 API 연동 기능은 유지하면서,
  3D 뷰 렌더러는 VWorld로 교체했습니다.
- 건물 선택은 `MODEL_NAME` 기반 `BLD_*` ID로 먼저 매핑하고,
  VWorld 내에 실제 모델이 없는 D4은 좌표 마커 폴백으로 처리합니다.
- Legacy 화면과 VWorld 화면을 별도 엔트리(`index.html`, `index-vworld.html`)로 병행 실행할 수 있습니다.

## 관련 폴더

- `frontend/src/vworld/`: VWorld 렌더러 본체와 선택/카메라/마커 핸들러
- `weather/api/app.py`: 미기후 팝업용 엔드포인트(
  `/microclimate/elements/{element_id}/popup`
  등)
- `vision_api.py`: 트래픽 탭에서 사용하는 카메라/차량 카운팅 API

## 실행 인수인계(복붙용)

명령은 저장소 루트 `README.md`와 같습니다. 따로 적지 않으면 저장소 루트에서 실행하고, 가상환경은 활성화하지 않고 인터프리터 경로로 바로 부릅니다. 자세한 설명과 다른 포트로 띄우는 방법은 루트 `README.md`에 있습니다.

설치(루트 `.venv` 하나에 세 서비스 의존성):

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

서비스마다 터미널 창을 하나씩 씁니다.

1) Weather API (`127.0.0.1:8000`):

```bash
.venv/bin/python -m uvicorn api.app:app --app-dir weather --host 127.0.0.1 --port 8000
```

```powershell
.venv\Scripts\python.exe -m uvicorn api.app:app --app-dir weather --host 127.0.0.1 --port 8000
```

2) Vision API (`127.0.0.1:8001`):

```bash
.venv/bin/python vision_api.py --source 0 --port 8001
```

```powershell
.venv\Scripts\python.exe vision_api.py --source 0 --port 8001
```

3) 교통 시뮬레이션 API (`127.0.0.1:8002`):

```bash
cd backend && ../.venv/bin/python -m uvicorn simulation.main:app --host 127.0.0.1 --port 8002
```

```powershell
cd backend; ..\.venv\Scripts\python -m uvicorn simulation.main:app --host 127.0.0.1 --port 8002
```

4) Frontend (`127.0.0.1:5173`), Legacy 모드:

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

## 정적 데모(`docs/index.html`) 키 설정

정적 데모는 키를 소스에 넣지 않고 `docs/vworld-key.local.js`에서 읽습니다. 이 파일은 `.gitignore`에 들어 있으니 예시를 복사한 뒤 `window.SCNU_VWORLD_API_KEY` 값만 채우세요.

```bash
cp docs/vworld-key.local.example.js docs/vworld-key.local.js
```

```powershell
cp docs\vworld-key.local.example.js docs\vworld-key.local.js
```

키가 없으면 데모 화면에 키 설정 안내가 뜹니다.

## 확인 포인트

- Legacy/VWorld 모두:
  - 브라우저 접속 후 지도가 정상 렌더링되는지
- VWorld 모드만:
  - 지도가 안 뜨면 `frontend/.env`의 `VITE_VWORLD_API_KEY` 값 확인

- 지도가 안 보이면 `VITE_VWORLD_API_KEY` 누락/오타 여부 확인
- 미기후 팝업이 비어 있으면 백엔드에서 `/microclimate/elements/{id}/popup` 응답을 확인
- Weather API 외부 호출 지연 시 `/environment/full`은 실패할 수 있으므로,
  미기후 팝업(백엔드 내부 microclimate) 중심으로 우선 검증
