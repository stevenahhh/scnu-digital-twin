import { useCallback, useEffect, useMemo, useState } from "react";
import { kstMinuteOfDay, minuteOfDayFromParts, splitMinuteOfDay } from "../weather/sceneClock.mjs";
import { CAMPUS_LOCATION, createSimulationDate, getSunState } from "../utils/sunPosition.mjs";

const RAD_TO_DEG = 180 / Math.PI;

// 분이 바뀔 때만 다시 그리는 현재 시각. 초 단위 시계는 패널의 PanelClock이 따로 돌려 대시보드 전체가 매초 다시 그려지지 않게 한다.
function useMinuteClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const untilNextMinute = 60000 - (now.getTime() % 60000);
    const timer = window.setTimeout(() => setNow(new Date()), untilNextMinute);
    return () => window.clearTimeout(timer);
  }, [now]);
  return now;
}

// 두 대시보드가 함께 쓰는 해 시계. 실측(live) 모드는 지금 시각, 시뮬레이션 모드는 월·일·시·분 입력으로 해 위치를 구한다.
// 시간 슬라이더는 하루 0..1439분(KST) 하나로 시·분을 움직이고, 움직이면 그 시각부터 시뮬레이션 모드가 된다.
export function useSunClock() {
  const now = useMinuteClock();
  const [mode, setMode] = useState("simulation");
  const [sunMonth, setSunMonth] = useState(() => now.getMonth() + 1);
  const [sunDay, setSunDay] = useState(() => now.getDate());
  const [sunHour, setSunHour] = useState(() => now.getHours());
  const [sunMinute, setSunMinute] = useState(() => now.getMinutes());
  const [simTemp, setSimTemp] = useState(20);

  const isLiveMode = mode === "live";
  const sunDate = useMemo(
    () => (isLiveMode
      ? now
      : createSimulationDate({ month: sunMonth, day: sunDay, hour: sunHour, minute: sunMinute }, now.getFullYear())),
    [now, isLiveMode, sunDay, sunHour, sunMinute, sunMonth],
  );
  const sunState = useMemo(
    () => getSunState({ date: sunDate, latitude: CAMPUS_LOCATION.latitude, longitude: CAMPUS_LOCATION.longitude }),
    [sunDate],
  );

  const setSceneMinuteOfDay = useCallback((minute) => {
    const parts = splitMinuteOfDay(minute);
    setSunHour(parts.hour);
    setSunMinute(parts.minute);
    setMode("simulation");
  }, []);

  return {
    mode, setMode, isLiveMode, simTemp, setSimTemp,
    sunMonth, setSunMonth, sunDay, setSunDay, sunHour, setSunHour, sunMinute, setSunMinute,
    sunDate, sunState,
    sunAltitudeDegrees: sunState.altitude * RAD_TO_DEG,
    sunBearingDegrees: (sunState.azimuth * RAD_TO_DEG + 540) % 360,
    sceneMinuteOfDay: isLiveMode ? kstMinuteOfDay(now) : minuteOfDayFromParts({ hour: sunHour, minute: sunMinute }),
    setSceneMinuteOfDay,
  };
}
