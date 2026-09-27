import { describe, expect, it } from "vitest";

import { countdownText, describeStrip, isDenseWindow, needsWinnerRefresh, type F1Calendar } from "../features/calendar/race-strip-model.ts";

const winner = { driver: "Andrea Kimi Antonelli", driverZh: "安东内利", team: "Mercedes", teamZh: "梅赛德斯" };

const calendar: F1Calendar = {
  season: 2026,
  timezone: "Asia/Shanghai",
  races: [
    {
      round: 14, name: "Spanish Grand Prix", nameZh: "西班牙站", circuit: "Madring", sprint: false, status: "scheduled",
      sessions: [
        { key: "fp1", start: "2026-09-11T11:30:00Z" },
        { key: "race", start: "2026-09-13T13:00:00Z" }
      ],
      winner
    },
    {
      round: 15, name: "Azerbaijan Grand Prix", nameZh: "阿塞拜疆站", circuit: "Baku City Circuit", sprint: false, status: "scheduled",
      sessions: [
        { key: "fp1", start: "2026-09-24T08:30:00Z" },
        { key: "fp2", start: "2026-09-24T12:00:00Z" },
        { key: "fp3", start: "2026-09-25T08:30:00Z" },
        { key: "q", start: "2026-09-25T12:00:00Z" },
        { key: "race", start: "2026-09-26T11:00:00Z" }
      ],
      winner: null
    },
    {
      round: 16, name: "Bahrain Grand Prix in Malaysia", nameZh: "巴林站", circuit: "Sepang International Circuit", sprint: false, status: "scheduled", noteZh: "马来西亚·雪邦",
      sessions: [
        { key: "fp1", start: "2026-10-02T04:30:00Z" },
        { key: "race", start: "2026-10-04T07:00:00Z" }
      ],
      winner: null
    },
    {
      round: 17, name: "Singapore Grand Prix", nameZh: "新加坡站", circuit: "Marina Bay Street Circuit", sprint: true, status: "scheduled",
      sessions: [
        { key: "fp1", start: "2026-10-09T08:30:00Z" },
        { key: "sq", start: "2026-10-09T12:30:00Z" },
        { key: "s", start: "2026-10-10T09:00:00Z" },
        { key: "q", start: "2026-10-10T13:00:00Z" },
        { key: "race", start: "2026-10-11T12:00:00Z" }
      ],
      winner: null
    }
  ]
};

describe("race strip clock", () => {
  it("formats the four acceptance moments", () => {
    const countdown = describeStrip(calendar, new Date("2026-09-26T12:28:00+08:00"));
    expect(countdown?.headline).toBe("阿塞拜疆站 · 正赛 今天 19:00 · 还有 6小时32分");
    expect(countdown?.mobileAside).toBe("还有 6时32分");
    expect(countdown?.showTimeline).toBe(true);

    const live = describeStrip(calendar, new Date("2026-09-26T19:40:00+08:00"));
    expect(live?.headline).toBe("阿塞拜疆站 · 正赛 预计进行中");
    expect(live?.mobileAside).toBe("19:00 开赛");
    expect(live?.sessions.find((session) => session.key === "race")?.phase).toBe("live");

    const after = describeStrip(calendar, new Date("2026-09-26T21:40:00+08:00"));
    expect(after?.headline).toContain("正赛预计结束");
    expect(after?.meta.startsWith("上站 西班牙 · 安东内利")).toBe(true);
    expect(after?.meta).toContain("下站 巴林（马来西亚·雪邦）10/2–4");

    const withWinner: F1Calendar = {
      ...calendar,
      races: calendar.races.map((race) => race.round === 15 ? { ...race, winner } : race)
    };
    expect(describeStrip(withWinner, new Date("2026-09-26T19:40:00+08:00"))?.headline).toContain("正赛已结束");
    expect(describeStrip(withWinner, new Date("2026-09-26T19:40:00+08:00"))?.sessions.find((session) => session.key === "race")?.phase).toBe("done");

    const between = describeStrip(calendar, new Date("2026-09-17T20:00:00+08:00"));
    expect(between?.headline).toBe("下一站 阿塞拜疆站 · 9/24–26 · 正赛 9/26 周六 19:00 · 还有 8天23小时");
    expect(between?.meta).toBe("上站 西班牙 · 安东内利");
    expect(between?.showTimeline).toBe(false);

    const sprint = describeStrip(calendar, new Date("2026-10-10T17:20:00+08:00"));
    expect(sprint?.headline).toBe("新加坡站 · 冲刺赛 预计进行中");
    expect(sprint?.panelSprint).toBe(true);
  });

  it("keeps a cancelled session off the next-session slot", () => {
    const altered: F1Calendar = {
      ...calendar,
      races: calendar.races.map((race) => race.round === 15 ? {
        ...race,
        sessions: race.sessions.map((session) => session.key === "q" ? { ...session, status: "cancelled" as const } : session)
      } : race)
    };
    const view = describeStrip(altered, new Date("2026-09-25T12:10:00Z"));
    expect(view?.sessions.find((session) => session.key === "q")?.phase).toBe("cancelled");
    expect(view?.headline.startsWith("阿塞拜疆站 · 正赛")).toBe(true);
  });

  it("uses the same dense window as the publisher", () => {
    expect(isDenseWindow(calendar, new Date("2026-09-26T10:50:00Z"))).toBe(true);
    expect(isDenseWindow(calendar, new Date("2026-09-17T12:00:00Z"))).toBe(false);
    expect(needsWinnerRefresh(calendar, new Date("2026-09-26T16:00:00Z"))).toBe(true);
    expect(countdownText(6 * 3600000 + 32 * 60000, "desktop")).toBe("6小时32分");
    expect(countdownText(30_000, "compact")).toBe("即将开始");
    expect(describeStrip(calendar, new Date("2026-09-26T10:59:30Z"))?.mobileAside).toBe("即将开始");
  });
});
