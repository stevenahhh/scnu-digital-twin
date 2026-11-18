import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

// 로그인 화면이 그려진 뒤 쉬는 틈에 3D 모델을 미리 받기 시작한다.
if (new URLSearchParams(window.location.search).get("ui") !== "gallery") {
  const whenIdle = window.requestIdleCallback ?? ((callback) => window.setTimeout(callback, 200));
  whenIdle(() => {
    import("./loading/preloadCampus.mjs").catch((error) => console.warn(`campus model preload failed: ${error.message}`));
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
