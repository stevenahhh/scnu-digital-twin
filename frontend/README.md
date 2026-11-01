## Frontend (Legacy + VWorld)

이 디렉터리에는 두 개의 대시보드가 함께 들어 있습니다. Legacy(`index.html`, Three.js)와 VWorld(`index-vworld.html`)는 별개의 제품이라 공통 동작을 바꾸면 두 빌드를 모두 확인해야 합니다.

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

Legacy 모드는 `VITE_API_URL` 만 있어도 뜹니다. 영상 분석이나 시뮬레이션 서버가 꺼져 있으면 해당 패널만 연결 없음 상태로 표시됩니다.

### 개발 서버

```bash
cd frontend && bun install
```

```powershell
cd frontend; bun install
```

Legacy (`http://127.0.0.1:5173`):

```bash
cd frontend && bun run dev:legacy
```

```powershell
cd frontend; bun run dev:legacy
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

### 점검 체크리스트

- 건물을 클릭하면 오른쪽 패널이나 팝업이 뜨는지
- D4(공과대학 3호관) 좌표 마커 클릭이 동작하는지
- VWorld 모드에서 콘솔에 `vw` 객체 생성 오류가 없는지
- 기상 서버가 응답하지 않을 때 `기상 서버에 연결할 수 없습니다` 같은 상태 문구와 `다시 시도` 버튼이 보이는지

미기후 팝업 API 계약은 [WEATHER_API.md](./WEATHER_API.md) 에 정리되어 있습니다.
