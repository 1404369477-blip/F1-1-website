#!/usr/bin/env node
/**
 * Builds public/data/f1-calendar.json from Jolpica. A failed request keeps the
 * previous file, then the committed fallback. It never fails the publish.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const OUTPUT = process.env.F1_CALENDAR_OUTPUT ?? resolve(ROOT, "public-site/public/data/f1-calendar.json");
const FALLBACK = process.env.F1_CALENDAR_FALLBACK ?? resolve(ROOT, "data/f1-calendar-2026.json");
const OVERRIDES = process.env.F1_CALENDAR_OVERRIDES ?? resolve(ROOT, "data/f1-calendar-overrides.json");
const NAMES = process.env.F1_CALENDAR_NAMES ?? resolve(ROOT, "data/f1-names-zh.json");
const META = process.env.F1_CALENDAR_META ?? resolve(dirname(OUTPUT), "f1-calendar-meta.json");
const SEASON = process.env.F1_CALENDAR_SEASON ?? String(new Date().getUTCFullYear());
const TIMEOUT_MS = 8000;

const SESSION_KEYS = {
  FirstPractice: "fp1",
  SecondPractice: "fp2",
  ThirdPractice: "fp3",
  SprintQualifying: "sq",
  SprintShootout: "sq",
  Sprint: "s",
  Qualifying: "q"
};

function readJson(path, fallback) {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function jolpica(path) {
  const response = await fetch(`https://api.jolpi.ca/ergast/f1/${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return response.json();
}

function stamp(date, time) {
  if (!date) return null;
  const clock = time && time.length > 0 ? time : "00:00:00Z";
  return `${date}T${clock.endsWith("Z") ? clock : `${clock}Z`}`;
}

function named(map, key) {
  return map?.[key] ?? key;
}

function mergeSessions(base, extra) {
  if (!Array.isArray(extra)) return base;
  const merged = new Map(base.map((session) => [session.key, session]));
  for (const session of extra) {
    if (!session?.key) continue;
    merged.set(session.key, { ...merged.get(session.key), ...session });
  }
  return [...merged.values()].sort((a, b) => String(a.start).localeCompare(String(b.start)));
}

function build(schedule, results, names, overrides) {
  const winners = new Map();
  for (const race of results?.MRData?.RaceTable?.Races ?? []) {
    const result = race.Results?.[0];
    if (!result) continue;
    const driver = `${result.Driver?.givenName ?? ""} ${result.Driver?.familyName ?? ""}`.trim();
    const team = result.Constructor?.name ?? "";
    winners.set(String(race.round), {
      driver,
      driverZh: named(names.drivers, driver),
      team,
      teamZh: named(names.teams, team)
    });
  }
  const races = (schedule?.MRData?.RaceTable?.Races ?? []).map((race) => {
    const sessions = [];
    for (const [field, key] of Object.entries(SESSION_KEYS)) {
      const start = stamp(race[field]?.date, race[field]?.time);
      if (start) sessions.push({ key, start });
    }
    const raceStart = stamp(race.date, race.time);
    if (raceStart) sessions.push({ key: "race", start: raceStart });
    sessions.sort((a, b) => a.start.localeCompare(b.start));
    const name = race.raceName;
    return {
      round: Number(race.round),
      name,
      nameZh: named(names.races, name),
      circuit: race.Circuit?.circuitName ?? "",
      sprint: Boolean(race.Sprint),
      status: "scheduled",
      ...(names.notes?.[name] ? { noteZh: names.notes[name] } : {}),
      sessions,
      winner: winners.get(String(race.round)) ?? null
    };
  });
  for (const override of Array.isArray(overrides) ? overrides : []) {
    const index = races.findIndex((race) => race.round === override.round);
    if (index < 0 || !override || typeof override !== "object") continue;
    const current = races[index];
    races[index] = {
      ...current,
      ...override,
      sessions: mergeSessions(current.sessions, override.sessions)
    };
  }
  return {
    season: Number(schedule?.MRData?.RaceTable?.season ?? SEASON),
    timezone: "Asia/Shanghai",
    races
  };
}

function keepPrevious(reason) {
  if (existsSync(OUTPUT)) {
    process.stdout.write(`${JSON.stringify({ action: "失败回退", reason, used: "previous" })}\n`);
    return;
  }
  const fallback = readJson(FALLBACK, null);
  if (fallback) {
    writeJson(OUTPUT, fallback);
    process.stdout.write(`${JSON.stringify({ action: "失败回退", reason, used: "fallback" })}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify({ action: "失败回退", reason, used: "none" })}\n`);
}

try {
  const [schedule, results] = await Promise.all([
    jolpica(`${SEASON}.json`),
    jolpica(`${SEASON}/results/1.json?limit=100`)
  ]);
  const calendar = build(schedule, results, readJson(NAMES, {}), readJson(OVERRIDES, []));
  if (!calendar.races.length) throw new Error("EMPTY_CALENDAR");
  writeJson(OUTPUT, calendar);
  writeJson(FALLBACK, calendar);
  writeJson(META, { fetchedAt: new Date().toISOString(), season: calendar.season, races: calendar.races.length });
  process.stdout.write(`${JSON.stringify({ action: "拉取", races: calendar.races.length })}\n`);
} catch (error) {
  keepPrevious(error instanceof Error ? error.message.slice(0, 160) : "UNKNOWN");
}
