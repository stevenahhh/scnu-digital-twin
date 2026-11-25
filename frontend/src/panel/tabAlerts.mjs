import { isFeedDown } from "../hooks/feedStatusModel.mjs";

const WATCHED_FEEDS = ["weather", "traffic", "energy"];

// 패널 탭 아이콘의 점: 탭마다 확인할 일의 수. 현황 탭은 끊긴 피드와 진행 중인 통제·공사 알림을 센다. 없는 탭은 키가 없다.
export function statusTabAlerts(feeds, restrictions = []) {
  const count = WATCHED_FEEDS.filter((feed) => isFeedDown(feeds[feed])).length + restrictions.length;
  return count > 0 ? { status: count } : {};
}

export const totalTabAlerts = (alerts) => Object.values(alerts).reduce((sum, count) => sum + count, 0);
export const alertLabel = (count) => `확인할 알림 ${count}건`;
