import { describe, expect, it } from "vitest";

import {
  SEASON_2026,
  formatCountdown,
  resolveRaceView
} from "../modules/race/calendar.ts";

const dutch = SEASON_2026[0];

describe("2026 race calendar", () => {
  it("keeps Dutch GP sprint weekend sessions in UTC", () => {
    expect(dutch.round).toBe(12);
    expect(dutch.sprintWeekend).toBe(true);
    expect(dutch.sessions.map((session) => session.startUtc)).toEqual([
      "2026-08-21T10:30:00.000Z",
      "2026-08-21T14:30:00.000Z",
      "2026-08-22T10:00:00.000Z",
      "2026-08-22T14:00:00.000Z",
      "2026-08-23T13:00:00.000Z"
    ]);
  });

  it("resolves idle countdown to the race before race week", () => {
    const now = Date.parse("2026-08-16T14:40:00.000Z");
    const view = resolveRaceView(now);
    expect(view.phase).toBe("idle");
    expect(view.round?.round).toBe(12);
    expect(view.nextSession?.key).toBe("race");
    expect(formatCountdown(view.countdownToMs, now, Date.parse("2026-08-23T13:00:00.000Z"))).toBe("6天 22小时");
  });

  it("switches to race week countdown toward FP1", () => {
    const now = Date.parse("2026-08-18T12:00:00.000Z");
    const view = resolveRaceView(now);
    expect(view.phase).toBe("race_week");
    expect(view.nextSession?.key).toBe("fp1");
  });

  it("marks sprint as live from the session time window", () => {
    const now = Date.parse("2026-08-22T10:15:00.000Z");
    const view = resolveRaceView(now);
    expect(view.phase).toBe("live");
    expect(view.liveSession?.key).toBe("sprint");
    expect(view.nextSession?.key).toBe("quali");
  });

  it("uses weekend phase between sessions", () => {
    const now = Date.parse("2026-08-22T12:00:00.000Z");
    const view = resolveRaceView(now);
    expect(view.phase).toBe("weekend");
    expect(view.liveSession).toBeNull();
    expect(view.nextSession?.key).toBe("quali");
  });

  it("enters post after the race and then points at Monza", () => {
    const now = Date.parse("2026-08-23T16:00:00.000Z");
    const view = resolveRaceView(now);
    expect(view.phase).toBe("post");
    expect(view.round?.round).toBe(12);
    expect(view.nextSession?.startUtc).toBe("2026-09-04T11:30:00.000Z");
  });

  it("returns offseason after the last stored post window", () => {
    const now = Date.parse("2026-09-07T12:00:00.000Z");
    const view = resolveRaceView(now);
    expect(view.phase).toBe("offseason");
    expect(view.round).toBeNull();
  });
});
