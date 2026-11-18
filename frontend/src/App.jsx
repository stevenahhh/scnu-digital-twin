import { Suspense, lazy, useEffect, useState, useSyncExternalStore } from "react";
import { LoginScreen } from "./auth/LoginScreen.jsx";
import { useSession } from "./auth/useSession.mjs";
import { CampusLoadingVeil } from "./loading/CampusLoadingVeil.jsx";
import { campusLoad } from "./loading/campusLoad.mjs";

// 역할마다 화면이 다르다. 따로 나눠 불러와 학생 화면은 관리자 대시보드(에너지·시뮬레이션 탭)를 내려받지 않는다.
const SCREENS = Object.freeze({
  admin: lazy(() => import("./AppMain")),
  student: lazy(() => import("./student/AppStudent")),
});
const LOGIN_EXIT_MS = 300;
// ?ui=gallery는 공용 기본 요소 확인 화면만 띄운다(로그인 없이). 따로 나눠 불러와 제품 번들에는 들어가지 않는다.
const UiGallery = lazy(() => import("./ui/Gallery.jsx"));
const SHOW_UI_GALLERY = new URLSearchParams(window.location.search).get("ui") === "gallery";

// 기본 진입점(index.html). 로딩 막은 로그인 화면 뒤에서 시작해 장면이 뜰 때까지 끊기지 않고 이어진다.
// 로그인하면 카드는 사라지고, 그 뒤에서 계정 역할의 화면이 준비된다.
export default function App() {
  return SHOW_UI_GALLERY ? <Suspense fallback={null}><UiGallery /></Suspense> : <Product />;
}

function Product() {
  const session = useSession();
  const load = useSyncExternalStore(campusLoad.subscribe, campusLoad.getState);
  const [revealed, setRevealed] = useState(false);
  const [loginMounted, setLoginMounted] = useState(!session);
  const ready = Boolean(session) && load.settled;

  useEffect(() => {
    if (!ready) setRevealed(false);
  }, [ready]);
  useEffect(() => {
    if (!session) {
      setLoginMounted(true);
      return undefined;
    }
    const timer = window.setTimeout(() => setLoginMounted(false), LOGIN_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [session]);

  const Screen = session && SCREENS[session.account.role];
  return (
    <>
      {Screen && <Suspense fallback={null}><Screen /></Suspense>}
      {!(ready && revealed) && <CampusLoadingVeil finish={ready} onDone={() => setRevealed(true)} />}
      {(loginMounted || !session) && <LoginScreen leaving={Boolean(session)} />}
    </>
  );
}
