import { useSyncExternalStore } from "react";
import { sessionStore } from "./session.mjs";

// 지금 로그인한 세션({ token, expiresAt, account }) 또는 null. 로그인·로그아웃·세션 만료 때 다시 그린다.
export function useSession(store = sessionStore) {
  return useSyncExternalStore(store.subscribe, store.getSession, store.getSession);
}

export const ROLE_LABELS = Object.freeze({ student: "학생", admin: "관리자" });

// 더보기 메뉴에 보일 계정 한 줄: `게스트 · 관리자`, `20239901 · 학생`.
export const accountLabel = (account) => `${account.guest ? "게스트" : account.id} · ${ROLE_LABELS[account.role]}`;
