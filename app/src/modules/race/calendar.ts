export type RaceSessionKey = "fp1" | "sprint_quali" | "sprint" | "quali" | "race";

export type RaceSession = {
  key: RaceSessionKey;
  labelZh: string;
  startUtc: string;
  typicalDurationMs: number;
};

export type RaceRound = {
  season: 2026;
  round: number;
  nameZh: string;
  circuitZh: string;
  sprintWeekend: boolean;
  sessions: readonly RaceSession[];
};

export type RacePhase = "idle" | "race_week" | "weekend" | "live" | "post" | "offseason";

export type ResolvedRaceView = {
  phase: RacePhase;
  round: RaceRound | null;
  nextSession: RaceSession | null;
  liveSession: RaceSession | null;
  countdownToMs: number;
};

export const SESSION_DURATION_MS = {
  fp1: 60 * 60 * 1000,
  sprint_quali: 44 * 60 * 1000,
  sprint: 30 * 60 * 1000,
  quali: 60 * 60 * 1000,
  race: 2 * 60 * 60 * 1000
} as const;

const RACE_WEEK_MS = 4 * 24 * 60 * 60 * 1000;
const POST_RACE_MS = 18 * 60 * 60 * 1000;

export const SEASON_2026: readonly RaceRound[] = [
  {
    season: 2026,
    round: 12,
    nameZh: "荷兰大奖赛",
    circuitZh: "赞德福特",
    sprintWeekend: true,
    sessions: [
      { key: "fp1", labelZh: "FP1", startUtc: "2026-08-21T10:30:00.000Z", typicalDurationMs: SESSION_DURATION_MS.fp1 },
      { key: "sprint_quali", labelZh: "冲刺排位", startUtc: "2026-08-21T14:30:00.000Z", typicalDurationMs: SESSION_DURATION_MS.sprint_quali },
      { key: "sprint", labelZh: "冲刺赛", startUtc: "2026-08-22T10:00:00.000Z", typicalDurationMs: SESSION_DURATION_MS.sprint },
      { key: "quali", labelZh: "排位赛", startUtc: "2026-08-22T14:00:00.000Z", typicalDurationMs: SESSION_DURATION_MS.quali },
      { key: "race", labelZh: "正赛", startUtc: "2026-08-23T13:00:00.000Z", typicalDurationMs: SESSION_DURATION_MS.race }
    ]
  },
  {
    season: 2026,
    round: 13,
    nameZh: "意大利大奖赛",
    circuitZh: "蒙扎",
    sprintWeekend: false,
    sessions: [
      { key: "fp1", labelZh: "FP1", startUtc: "2026-09-04T11:30:00.000Z", typicalDurationMs: SESSION_DURATION_MS.fp1 },
      { key: "quali", labelZh: "排位赛", startUtc: "2026-09-05T14:00:00.000Z", typicalDurationMs: SESSION_DURATION_MS.quali },
      { key: "race", labelZh: "正赛", startUtc: "2026-09-06T13:00:00.000Z", typicalDurationMs: SESSION_DURATION_MS.race }
    ]
  }
];

function sessionStart(session: RaceSession): number {
  return Date.parse(session.startUtc);
}

function sessionEnd(session: RaceSession): number {
  return sessionStart(session) + session.typicalDurationMs;
}

function raceSession(round: RaceRound): RaceSession {
  const race = round.sessions.find((session) => session.key === "race");
  if (!race) {
    throw new Error(`race calendar missing race session for R${round.round}`);
  }
  return race;
}

function firstSession(round: RaceRound): RaceSession {
  const first = round.sessions[0];
  if (!first) {
    throw new Error(`race calendar missing sessions for R${round.round}`);
  }
  return first;
}

export function resolveRaceView(nowMs: number, rounds: readonly RaceRound[] = SEASON_2026): ResolvedRaceView {
  const remaining = rounds.filter((round) => nowMs < sessionEnd(raceSession(round)) + POST_RACE_MS);
  if (remaining.length === 0) {
    return { phase: "offseason", round: null, nextSession: null, liveSession: null, countdownToMs: 0 };
  }

  const current = remaining[0];
  const first = firstSession(current);
  const race = raceSession(current);
  const firstStart = sessionStart(first);
  const raceEnd = sessionEnd(race);

  if (nowMs >= raceEnd && nowMs < raceEnd + POST_RACE_MS) {
    const nextRound = remaining[1] ?? null;
    return {
      phase: "post",
      round: current,
      nextSession: nextRound ? firstSession(nextRound) : null,
      liveSession: null,
      countdownToMs: nextRound ? Math.max(0, sessionStart(firstSession(nextRound)) - nowMs) : 0
    };
  }

  const live = current.sessions.find((session) => nowMs >= sessionStart(session) && nowMs < sessionEnd(session));
  if (live) {
    const upcoming = current.sessions.find((session) => sessionStart(session) > nowMs) ?? null;
    return {
      phase: "live",
      round: current,
      nextSession: upcoming,
      liveSession: live,
      countdownToMs: upcoming ? sessionStart(upcoming) - nowMs : Math.max(0, raceEnd - nowMs)
    };
  }

  if (nowMs >= firstStart && nowMs < raceEnd) {
    const next = current.sessions.find((session) => sessionStart(session) > nowMs) ?? race;
    return {
      phase: "weekend",
      round: current,
      nextSession: next,
      liveSession: null,
      countdownToMs: Math.max(0, sessionStart(next) - nowMs)
    };
  }

  if (nowMs >= firstStart - RACE_WEEK_MS) {
    return {
      phase: "race_week",
      round: current,
      nextSession: first,
      liveSession: null,
      countdownToMs: Math.max(0, firstStart - nowMs)
    };
  }

  return {
    phase: "idle",
    round: current,
    nextSession: race,
    liveSession: null,
    countdownToMs: Math.max(0, sessionStart(race) - nowMs)
  };
}

export function formatCountdown(ms: number, nowMs: number, targetMs: number): string {
  const clamped = Math.max(0, ms);
  const days = Math.floor(clamped / 86400000);
  const hours = Math.floor((clamped % 86400000) / 3600000);
  const minutes = Math.floor((clamped % 3600000) / 60000);
  const sameCalendarDay = new Date(nowMs).toISOString().slice(0, 10) === new Date(targetMs).toISOString().slice(0, 10);
  if (sameCalendarDay || days === 0) {
    return `${hours}小时 ${minutes}分`;
  }
  return `${days}天 ${hours}小时`;
}

export function formatBeijingClock(utc: string): string {
  const date = new Date(utc);
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const read = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  return `${read("month")}月${read("day")}日 ${read("weekday")} ${read("hour")}:${read("minute")}`;
}
