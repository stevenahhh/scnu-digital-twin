/* @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({ fetchEnvironment: vi.fn() }));
vi.mock("./weatherFeedCore.mjs", () => core);

import { WEATHER_API_URL } from "../simulation/utils/apiConfig";
import { useWeatherFeed } from "./useWeatherFeed";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

const live = (temperature) => ({ state: "live", data: { base_weather: { temperature } }, freshness: null, message: null });

afterEach(() => {
  cleanup();
  core.fetchEnvironment.mockReset();
});

describe("useWeatherFeed", () => {
  it("keeps the newest refresh result when an older response arrives later", async () => {
    const initial = deferred();
    const manual = deferred();
    core.fetchEnvironment.mockReturnValueOnce(initial.promise).mockReturnValueOnce(manual.promise);
    const { result } = renderHook(() => useWeatherFeed("http://weather.test"));
    await waitFor(() => expect(core.fetchEnvironment).toHaveBeenCalledTimes(1));
    expect(result.current.isRefreshing).toBe(true);

    let manualRefresh;
    act(() => { manualRefresh = result.current.refresh(); });
    await act(async () => {
      manual.resolve(live(22));
      await manualRefresh;
    });
    expect(result.current.data.base_weather.temperature).toBe(22);
    expect(result.current.isRefreshing).toBe(false);

    await act(async () => {
      initial.resolve(live(11));
      await initial.promise;
    });
    expect(result.current.data.base_weather.temperature).toBe(22);
    expect(result.current.state).toBe("live");
    expect(result.current.isRefreshing).toBe(false);
  });

  it("requests the weather origin resolved by apiConfig by default", async () => {
    core.fetchEnvironment.mockResolvedValue(live(20));
    renderHook(() => useWeatherFeed());
    await waitFor(() => expect(core.fetchEnvironment).toHaveBeenCalled());
    expect(core.fetchEnvironment.mock.calls[0][1]).toBe(WEATHER_API_URL);
  });
});
