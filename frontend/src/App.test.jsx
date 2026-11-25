/* @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./loading/CampusLoadingVeil.jsx", () => ({ CampusLoadingVeil: () => null }));
vi.mock("./AppMain", () => ({ default: () => <p>관리자 대시보드</p> }));
vi.mock("./student/AppStudent", () => ({ default: () => <p>학생 화면</p> }));

import App from "./App.jsx";
import { sessionStore } from "./auth/session.mjs";

const FUTURE = "2099-01-01T00:00:00Z";
const account = (role, guest) => ({ id: guest ? `guest-${role}` : role === "admin" ? "admin" : "20239901", name: "계정", role, guest });
const granted = (role, guest) => ({ ok: true, status: 200, json: async () => ({ token: "t", token_type: "bearer", expires_at: FUTURE, account: account(role, guest) }) });

beforeEach(() => {
  const values = new Map();
  vi.stubGlobal("localStorage", { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) });
  window.matchMedia = vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});

afterEach(() => {
  cleanup();
  sessionStore.logout();
  vi.unstubAllGlobals();
});

describe("App entry", () => {
  it("opens on the login screen and sends each guest button to its own screen", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (_url, init) => granted(JSON.parse(init.body).role, true));
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    expect(screen.getByRole("heading", { name: "로그인" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "게스트 · 학생 모드" }));
    expect(await screen.findByText("학생 화면")).toBeTruthy();
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/auth\/guest$/);

    sessionStore.logout();
    await user.click(await screen.findByRole("button", { name: "게스트 · 관리자 모드" }));
    expect(await screen.findByText("관리자 대시보드")).toBeTruthy();
  });

  it("logs an account in with id and password and shows the server's reason when it is refused", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ detail: "아이디 또는 비밀번호가 올바르지 않습니다" }) })
      .mockResolvedValueOnce(granted("student", false));
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    await user.type(screen.getByLabelText("아이디"), "20239901");
    await user.type(screen.getByLabelText("비밀번호"), "00000000");
    await user.click(screen.getByRole("button", { name: "로그인" }));
    expect((await screen.findByRole("alert")).textContent).toContain("아이디 또는 비밀번호가 올바르지 않습니다");

    await user.clear(screen.getByLabelText("비밀번호"));
    await user.type(screen.getByLabelText("비밀번호"), "12341234");
    await user.click(screen.getByRole("button", { name: "로그인" }));
    expect(await screen.findByText("학생 화면")).toBeTruthy();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ id: "20239901", password: "12341234" });
  });

  it("never lets the password field hold more than 8 characters", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn());
    render(<App />);
    await user.type(screen.getByLabelText("비밀번호"), "1234123456");
    expect(screen.getByLabelText("비밀번호").value).toBe("12341234");
  });
});
