import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseCalendarPayload, watchCalendar } from "../features/calendar/calendar-client";

const calendar = {
  season: 2026, timezone: "Asia/Shanghai", races: [{
    round: 1, name: "Test GP", nameZh: "测试站", circuit: "Test", sprint: false,
    status: "scheduled", winner: null, sessions: [{ key: "race", start: "2026-09-28T11:00:00Z" }]
  }]
};

describe("calendar freshness and last good data", () => {
  let win: EventTarget;
  let doc: EventTarget & { visibilityState: string };
  let stop: (() => void) | undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    win = new EventTarget();
    Object.assign(win, { setTimeout, clearTimeout, setInterval, clearInterval });
    doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", doc);
  });
  afterEach(() => { stop?.(); stop = undefined; vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("rejects malformed dates, session keys and duplicate rounds before rendering", () => {
    expect(parseCalendarPayload(calendar)).not.toBeNull();
    const bad = structuredClone(calendar);
    bad.races[0]!.sessions[0]!.start = "not-a-date";
    expect(parseCalendarPayload(bad)).toBeNull();
    bad.races[0]!.sessions[0]!.start = "2026-09-28T11:00:00Z";
    bad.races[0]!.sessions[0]!.key = "unknown";
    expect(parseCalendarPayload(bad)).toBeNull();
    expect(parseCalendarPayload({ ...calendar, races: [...calendar.races, ...calendar.races] })).toBeNull();
    expect(parseCalendarPayload({ races: [] })).toBeNull();
    expect(parseCalendarPayload({ ...calendar, races: [{ ...calendar.races[0], sessions: [] }] })).toBeNull();
    expect(parseCalendarPayload({ ...calendar, races: [{ ...calendar.races[0], sessions: [{ key: "q", start: "2026-09-28T11:00:00Z" }] }] })).toBeNull();
  });

  it("refreshes after returning to the foreground and coalesces focus events", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(calendar));
    const received = vi.fn();
    stop = watchCalendar("/data/calendar.json", received, fetcher);
    await vi.advanceTimersByTimeAsync(0);
    expect(received).toHaveBeenCalledTimes(1);
    doc.visibilityState = "hidden";
    await vi.advanceTimersByTimeAsync(600_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    win.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(received).toHaveBeenCalledTimes(2);
  });

  it("retains good data through malformed and failed responses then recovers", async () => {
    const received = vi.fn();
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(calendar))
      .mockResolvedValueOnce(Response.json({ ...calendar, races: [{ ...calendar.races[0], sessions: [] }] }))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(Response.json({ ...calendar, season: 2027 }));
    stop = watchCalendar("/data/calendar.json", received, fetcher);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(received).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(received).toHaveBeenLastCalledWith({ ...calendar, season: 2027 });
  });

  it("aborts on unmount and ignores a response from an aborted request", async () => {
    let resolveResponse!: (response: Response) => void;
    let signal: AbortSignal | null | undefined;
    const fetcher: typeof fetch = async (_url, init) => {
      signal = init?.signal;
      return new Promise((resolve) => { resolveResponse = resolve; });
    };
    const received = vi.fn();
    stop = watchCalendar("/data/calendar.json", received, fetcher);
    stop();
    expect(signal?.aborted).toBe(true);
    resolveResponse(Response.json(calendar));
    await vi.advanceTimersByTimeAsync(0);
    expect(received).not.toHaveBeenCalled();
  });
});
