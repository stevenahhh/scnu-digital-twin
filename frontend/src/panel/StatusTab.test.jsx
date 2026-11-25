/* @vitest-environment jsdom */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { INITIAL_FEED_STATUS } from "../hooks/feedStatusModel.mjs";
import { StatusTab } from "./StatusTab.jsx";

afterEach(cleanup);

const down = { ...INITIAL_FEED_STATUS, status: "down", cause: "기상 서버에 연결할 수 없습니다", checkedAt: new Date("2026-11-10T10:00:00Z"), attempt: 1, retryInMs: 1000 };
const summary = { weather: null, isSimulationMode: false, status: "기상 서버에 연결할 수 없습니다", statusTone: "danger", lastGoodLabel: null, observedClock: null, skyStatus: null, airQuality: null, alerts: [], timeline: [] };
const trafficFeed = { state: "offline", stats: null, message: "영상 분석 서버 연결 없음" };
const feeds = { weather: down, traffic: down, energy: down };
const retry = { weather: () => {}, traffic: () => {}, energy: () => {} };

describe("StatusTab restriction notices", () => {
  it("lists active restrictions first and says they are a simulation scenario", () => {
    const restrictions = [{ id: "RST_1", target_type: "building", target_id: "BLD_C1", target_name: "도서관", cause: "construction", access: null, message: "외벽 보수", segments: [] }];
    render(<StatusTab summary={summary} feeds={feeds} retry={retry} trafficFeed={trafficFeed} restrictions={restrictions} />);
    const notices = document.querySelector("[data-qa=restriction-notices]");
    expect(within(notices).getByText("도서관")).toBeTruthy();
    expect(within(notices).getByText("공사 중")).toBeTruthy();
    expect(within(notices).getByText("외벽 보수")).toBeTruthy();
    expect(notices.textContent).toContain("실제 공지가 아닙니다");
  });
});

describe("StatusTab weather group while the weather feed is down", () => {
  it("keeps the five weather rows right below the alert, empty, with one 다시 시도 in the group", () => {
    render(<StatusTab summary={summary} feeds={feeds} retry={retry} trafficFeed={trafficFeed} />);
    const status = document.querySelector("[data-qa=weather-status]");
    const list = status.parentElement.querySelector("[data-qa=metric-list]");
    expect(list).not.toBeNull();
    expect(status.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(list).getByText("현재 기온")).toBeTruthy();
    expect(within(list).getAllByText("데이터 없음")).toHaveLength(5);
    const section = status.closest("section");
    expect(within(section).getAllByRole("button", { name: "다시 시도" })).toHaveLength(1);
    expect(within(section).queryByText(/관측/)).toBeNull();
  });

  it("shows no weather rows while the first response is still loading", () => {
    render(<StatusTab summary={summary} feeds={{ ...feeds, weather: INITIAL_FEED_STATUS }} retry={retry} trafficFeed={trafficFeed} />);
    expect(screen.queryByText("현재 기온")).toBeNull();
  });
});
