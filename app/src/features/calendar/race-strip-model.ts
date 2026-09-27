export const CALENDAR_TIME_ZONE = "Asia/Shanghai";

export type SessionKey = "fp1" | "fp2" | "fp3" | "sq" | "s" | "q" | "race";
export type RaceStatus = "scheduled" | "cancelled" | "postponed";
export type SessionStatus = "scheduled" | "cancelled";

export type CalendarSession = {
  key: SessionKey;
  start: string;
  status?: SessionStatus;
};

export type CalendarWinner = {
  driver: string;
  driverZh: string;
  team: string;
  teamZh: string;
};

export type CalendarRace = {
  round: number;
  name: string;
  nameZh: string;
  circuit: string;
  sprint: boolean;
  status: RaceStatus;
  noteZh?: string;
  sessions: CalendarSession[];
  winner: CalendarWinner | null;
};

export type F1Calendar = {
  season: number;
  timezone: typeof CALENDAR_TIME_ZONE;
  races: CalendarRace[];
};

export type SessionPhase = "done" | "live" | "next" | "later" | "cancelled";

export type StripSession = {
  key: SessionKey;
  short: string;
  full: string;
  title: string;
  phase: SessionPhase;
  timeLabel: string;
  statusLabel: string;
  tone: "done" | "live" | "upcoming" | "cancelled" | "postponed";
};

export type StripUpcoming = {
  nameZh: string;
  sprint: boolean;
  round: number;
  noteZh: string | null;
  dates: string;
  raceTime: string;
  status: RaceStatus;
};

export type StripView = {
  marker: "live" | "weekend" | "between" | "season";
  headline: string;
  mobileHeadline: string;
  mobileAside: string;
  showTimeline: boolean;
  meta: string;
  sessions: StripSession[];
  panelTitle: string;
  panelSprint: boolean;
  previous: { nameZh: string; dates: string; winner: string } | null;
  upcoming: StripUpcoming[];
};

const SESSION_META: Record<SessionKey, { full: string; short: string; minutes: number }> = {
  fp1: { full: "一练", short: "练1", minutes: 60 },
  fp2: { full: "二练", short: "练2", minutes: 60 },
  fp3: { full: "三练", short: "练3", minutes: 60 },
  sq: { full: "冲刺排位", short: "冲排", minutes: 45 },
  s: { full: "冲刺赛", short: "冲刺", minutes: 60 },
  q: { full: "排位赛", short: "排位", minutes: 60 },
  race: { full: "正赛", short: "正赛", minutes: 120 }
};

const WEEKDAY: Record<string, string> = {
  Sun: "周日", Mon: "周一", Tue: "周二", Wed: "周三", Thu: "周四", Fri: "周五", Sat: "周六"
};

type Clock = { y: number; m: number; d: number; hh: string; mm: string; weekday: string };

function clock(date: Date): Clock {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: CALENDAR_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
    hh: parts.hour ?? "00",
    mm: parts.minute ?? "00",
    weekday: WEEKDAY[parts.weekday ?? ""] ?? ""
  };
}

function dayIndex(value: Clock): number {
  return Date.UTC(value.y, value.m - 1, value.d);
}

export function countdownText(ms: number, style: "desktop" | "compact"): string {
  const total = Math.max(0, Math.floor(ms / 60000));
  if (total < 1) return "即将开始";
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const minutes = total % 60;
  if (days >= 1) return style === "desktop" ? `${days}天${hours}小时` : `${days}天${hours}时`;
  if (hours >= 1) return style === "desktop" ? `${hours}小时${minutes}分` : `${hours}时${minutes}分`;
  return style === "desktop" ? `${minutes}分钟` : `${minutes}分`;
}

function countdownPhrase(ms: number, style: "desktop" | "compact", lead: string): string {
  const text = countdownText(ms, style);
  return text === "即将开始" ? "即将开始" : `${lead}${text}`;
}

function whenLabel(target: Date, now: Date): string {
  const diff = Math.round((dayIndex(clock(target)) - dayIndex(clock(now))) / 86400000);
  if (diff === 0) return "今天";
  if (diff === 1) return "明天";
  if (diff === -1) return "昨天";
  const shown = clock(target);
  if (diff >= 2 && diff <= 6) return shown.weekday;
  return `${shown.m}/${shown.d} ${shown.weekday}`;
}

function clockLabel(target: Date): string {
  const shown = clock(target);
  return `${shown.hh}:${shown.mm}`;
}

function dateTimeLabel(target: Date): string {
  const shown = clock(target);
  return `${shown.m}/${shown.d} ${shown.weekday} ${shown.hh}:${shown.mm}`;
}

export function dateRangeLabel(start: Date, end: Date): string {
  const from = clock(start);
  const to = clock(end);
  if (from.y === to.y && from.m === to.m) return `${from.m}/${from.d}–${to.d}`;
  return `${from.m}/${from.d}–${to.m}/${to.d}`;
}

function station(nameZh: string): string {
  return nameZh.endsWith("站") ? nameZh.slice(0, -1) : nameZh;
}

function nextStationLabel(race: CalendarRace): string {
  const note = race.noteZh ? `（${race.noteZh}）` : "";
  const place = `${station(race.nameZh)}${note}`;
  return note ? `下站 ${place}${raceRange(race)}` : `下站 ${place} ${raceRange(race)}`;
}

/** True during a race session, from 15 minutes before the start until four hours after. Cleanup skips this window. */
export function isRaceWindow(calendar: F1Calendar, now: Date): boolean {
  const at = now.getTime();
  return calendar.races.some((race) => activeSessions(race).some((session) => {
    if (session.session.key !== "race") return false;
    return at >= session.start - 15 * 60 * 1000 && at < session.start + 4 * 3600 * 1000;
  }));
}

function durationMs(key: SessionKey): number {
  return SESSION_META[key].minutes * 60000;
}

type Timed = { race: CalendarRace; session: CalendarSession; start: number; end: number };

function activeSessions(race: CalendarRace): Timed[] {
  if (race.status !== "scheduled") return [];
  return race.sessions.flatMap((session) => {
    if (session.status === "cancelled") return [];
    const start = Date.parse(session.start);
    if (Number.isNaN(start)) return [];
    return [{ race, session, start, end: start + durationMs(session.key) }];
  }).sort((a, b) => a.start - b.start);
}

function bounds(race: CalendarRace): { start: number; end: number } | null {
  const sessions = activeSessions(race);
  const raceSession = sessions.find((item) => item.session.key === "race");
  const first = sessions[0];
  if (!first || !raceSession) return null;
  return { start: first.start - 24 * 3600 * 1000, end: raceSession.start + 24 * 3600 * 1000 };
}

function raceRange(race: CalendarRace): string {
  const stamps = race.sessions.map((session) => Date.parse(session.start)).filter((stamp) => !Number.isNaN(stamp)).sort((a, b) => a - b);
  if (stamps.length === 0) return "";
  return dateRangeLabel(new Date(stamps[0]!), new Date(stamps.at(-1)!));
}

function winnerLabel(race: CalendarRace): string {
  if (!race.winner) return "成绩待更新";
  return `${race.winner.driverZh} · ${race.winner.teamZh}`;
}

function winnerName(race: CalendarRace): string {
  return race.winner?.driverZh ?? "成绩待更新";
}

export function needsWinnerRefresh(calendar: F1Calendar, now: Date): boolean {
  const at = now.getTime();
  const unfinished = calendar.races.filter((race) => {
    if (race.status !== "scheduled" || race.winner) return false;
    const raceSession = activeSessions(race).find((session) => session.session.key === "race");
    return raceSession !== undefined && at >= raceSession.start;
  }).sort((a, b) => b.round - a.round)[0];
  if (!unfinished) return false;
  const next = calendar.races.find((race) => race.round === unfinished.round + 1);
  const nextStart = next ? activeSessions(next)[0]?.start : undefined;
  return nextStart === undefined || at < nextStart;
}

/** True from 15 minutes before a session until 3 hours after it, or 4 hours after a race. */
export function isDenseWindow(calendar: F1Calendar, now: Date): boolean {
  const at = now.getTime();
  return calendar.races.some((race) => activeSessions(race).some((session) => {
    const after = session.session.key === "race" ? 4 * 3600 * 1000 : 3 * 3600 * 1000;
    return at >= session.start - 15 * 60 * 1000 && at < session.start + after;
  }));
}

export function describeStrip(calendar: F1Calendar, now: Date): StripView | null {
  if (!calendar.races?.length) return null;
  const at = now.getTime();
  const scheduled = calendar.races.filter((race) => race.status === "scheduled").sort((a, b) => a.round - b.round);
  const liveCandidate = scheduled.flatMap(activeSessions).find((session) => at >= session.start && at < session.end) ?? null;
  const live = liveCandidate?.session.key === "race" && liveCandidate.race.winner ? null : liveCandidate;
  const weekend = scheduled.find((race) => {
    const window = bounds(race);
    return window !== null && at >= window.start && at < window.end;
  }) ?? null;
  const nextRace = scheduled.find((race) => {
    const window = bounds(race);
    return window !== null && at < window.start;
  }) ?? null;
  const focus = live?.race ?? weekend ?? nextRace;
  const previous = focus
    ? [...scheduled].reverse().find((race) => race.round < focus.round) ?? null
    : [...scheduled].reverse().find((race) => {
      const raceSession = activeSessions(race).find((session) => session.session.key === "race");
      return raceSession !== undefined && at >= raceSession.end;
    }) ?? null;
  if (!focus) return seasonEnd(calendar, previous);

  const sessions = sessionRows(focus, now);
  const upcoming = upcomingRaces(calendar, focus.round, now);
  const metaPrevious = previous ? `上站 ${station(previous.nameZh)} · ${winnerName(previous)}` : "";
  const following = scheduled.find((race) => race.round > focus.round);
  const metaNext = following ? nextStationLabel(following) : "";
  const meta = [metaPrevious, metaNext].filter(Boolean).join(" | ");

  if (live && live.race.round === focus.round) {
    const later = activeSessions(focus).find((session) => session.start > at);
    const aside = live.session.key === "race"
      ? `${clockLabel(new Date(live.start))} 开赛`
      : later
        ? `下一节 ${SESSION_META[later.session.key].full} ${whenLabel(new Date(later.start), now)} ${clockLabel(new Date(later.start))}`
        : "";
    return {
      marker: "live",
      headline: `${focus.nameZh} · ${SESSION_META[live.session.key].full} 预计进行中`,
      mobileHeadline: `${focus.nameZh} · ${SESSION_META[live.session.key].full} 预计进行中`,
      mobileAside: aside,
      showTimeline: true,
      meta,
      sessions,
      ...panel(focus, previous, upcoming)
    };
  }

  const raceSession = activeSessions(focus).find((session) => session.session.key === "race");
  if (weekend && raceSession && (at >= raceSession.end || (focus.winner !== null && at >= raceSession.start))) {
    const champion = winnerName(focus);
    return {
      marker: "weekend",
      headline: champion === "成绩待更新" ? `${focus.nameZh} · 正赛预计结束 · 成绩待更新` : `${focus.nameZh} · 正赛已结束 · ${champion} 夺冠`,
      mobileHeadline: `${focus.nameZh} · ${focus.winner ? "正赛已结束" : "正赛预计结束"}`,
      mobileAside: winnerName(focus) === "成绩待更新" ? "成绩待更新" : `${winnerName(focus)} 夺冠`,
      showTimeline: true,
      meta,
      sessions,
      ...panel(focus, previous, upcoming)
    };
  }

  if (weekend) {
    const nextSession = activeSessions(focus).find((session) => session.start > at);
    if (!nextSession) return null;
    const when = whenLabel(new Date(nextSession.start), now);
    const time = clockLabel(new Date(nextSession.start));
    const name = SESSION_META[nextSession.session.key].full;
    return {
      marker: "weekend",
      headline: `${focus.nameZh} · ${name} ${when} ${time} · ${countdownPhrase(nextSession.start - at, "desktop", "还有 ")}`,
      mobileHeadline: `${focus.nameZh} · ${name} ${when} ${time}`,
      mobileAside: countdownPhrase(nextSession.start - at, "compact", "还有 "),
      showTimeline: true,
      meta,
      sessions,
      ...panel(focus, previous, upcoming)
    };
  }

  const nextRaceSession = activeSessions(focus).find((session) => session.session.key === "race");
  if (!nextRaceSession) return null;
  const when = `${clock(new Date(nextRaceSession.start)).m}/${clock(new Date(nextRaceSession.start)).d} ${clock(new Date(nextRaceSession.start)).weekday} ${clockLabel(new Date(nextRaceSession.start))}`;
  return {
    marker: "between",
    headline: `下一站 ${focus.nameZh} · ${raceRange(focus)} · 正赛 ${when} · ${countdownPhrase(nextRaceSession.start - at, "desktop", "还有 ")}`,
    mobileHeadline: `下一站 ${focus.nameZh} · ${raceRange(focus)}`,
    mobileAside: countdownPhrase(nextRaceSession.start - at, "compact", "正赛 还有 "),
    showTimeline: false,
    meta: metaPrevious,
    sessions: [],
    ...panel(focus, previous, upcoming)
  };
}

function seasonEnd(calendar: F1Calendar, previous: CalendarRace | null): StripView {
  return {
    marker: "season",
    headline: `${calendar.season} 赛季已结束`,
    mobileHeadline: `${calendar.season} 赛季已结束`,
    mobileAside: "",
    showTimeline: false,
    meta: "",
    sessions: [],
    panelTitle: `${calendar.season} 赛季已结束`,
    panelSprint: false,
    previous: previous ? { nameZh: previous.nameZh, dates: raceRange(previous), winner: winnerLabel(previous) } : null,
    upcoming: []
  };
}

function panel(focus: CalendarRace, previous: CalendarRace | null, upcoming: StripUpcoming[]): Pick<StripView, "panelTitle" | "panelSprint" | "previous" | "upcoming"> {
  return {
    panelTitle: `第${focus.round}轮 · ${focus.nameZh}`,
    panelSprint: focus.sprint,
    previous: previous ? { nameZh: previous.nameZh, dates: raceRange(previous), winner: winnerLabel(previous) } : null,
    upcoming
  };
}

function sessionRows(race: CalendarRace, now: Date): StripSession[] {
  const at = now.getTime();
  const ordered = [...race.sessions].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const active = activeSessions(race);
  const live = active.find((session) => at >= session.start && at < session.end);
  const next = active.find((session) => session.start > at);
  return ordered.map((session) => {
    const start = Date.parse(session.start);
    const cancelled = session.status === "cancelled";
    const phase: SessionPhase = cancelled ? "cancelled"
      : session.key === "race" && race.winner && start <= at ? "done"
      : live?.session.key === session.key ? "live"
      : next?.session.key === session.key ? "next"
      : start + durationMs(session.key) <= at ? "done"
      : "later";
    const meta = SESSION_META[session.key];
    const shown = new Date(start);
    const statusLabel = cancelled ? "已取消"
      : phase === "done" ? (race.winner ? "已结束" : "预计结束")
      : phase === "live" ? "预计进行中"
      : countdownPhrase(start - at, "compact", "还有 ");
    return {
      key: session.key,
      short: meta.short,
      full: meta.full,
      title: `${meta.full} · ${dateTimeLabel(shown)} 北京时间`,
      phase,
      timeLabel: dateTimeLabel(shown),
      statusLabel,
      tone: cancelled ? "cancelled" : phase === "done" ? "done" : phase === "live" ? "live" : "upcoming"
    };
  });
}

function upcomingRaces(calendar: F1Calendar, afterRound: number, now: Date): StripUpcoming[] {
  return calendar.races
    .filter((race) => race.round > afterRound)
    .sort((a, b) => a.round - b.round)
    .slice(0, 3)
    .map((race) => {
      const raceSession = race.sessions.find((session) => session.key === "race");
      const start = raceSession ? new Date(raceSession.start) : now;
      const shown = clock(start);
      return {
        nameZh: race.nameZh,
        sprint: race.sprint,
        round: race.round,
        noteZh: race.noteZh ?? null,
        dates: raceRange(race),
        raceTime: `正赛 ${shown.m}/${shown.d} ${shown.weekday} ${shown.hh}:${shown.mm}`,
        status: race.status
      };
    });
}
