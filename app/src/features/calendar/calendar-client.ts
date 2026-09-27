import { z } from "zod";

import type { F1Calendar } from "./race-strip-model";

const text = z.string().trim().min(1).max(200);
const CalendarSchema = z.object({
  season: z.number().int().min(1950).max(2200),
  timezone: z.literal("Asia/Shanghai"),
  races: z.array(z.object({
    round: z.number().int().positive(),
    name: text,
    nameZh: text,
    circuit: text,
    sprint: z.boolean(),
    status: z.enum(["scheduled", "cancelled", "postponed"]),
    noteZh: text.optional(),
    sessions: z.array(z.object({
      key: z.enum(["fp1", "fp2", "fp3", "sq", "s", "q", "race"]),
      start: z.iso.datetime({ offset: true }),
      status: z.enum(["scheduled", "cancelled"]).optional()
    }).strict()).max(7).refine((sessions) => new Set(sessions.map((session) => session.key)).size === sessions.length),
    winner: z.object({ driver: text, driverZh: text, team: text, teamZh: text }).strict().nullable()
  }).strict().refine((race) => race.status !== "scheduled" || race.sessions.some((session) => session.key === "race")))
    .min(1).max(100).refine((races) => new Set(races.map((race) => race.round)).size === races.length)
}).strict();

export function parseCalendarPayload(value: unknown): F1Calendar | null {
  const result = CalendarSchema.safeParse(value);
  return result.success ? result.data : null;
}

/** Poll only in the foreground, coalesce focus/visibility events, retain the last good calendar. */
export function watchCalendar(url: string, onCalendar: (calendar: F1Calendar) => void, fetcher: typeof fetch = fetch): () => void {
  let stopped = false;
  let active: AbortController | null = null;
  let attemptedAt: number | null = null;
  const refresh = async () => {
    if (stopped || document.visibilityState === "hidden" || active !== null) return;
    if (attemptedAt !== null && Date.now() - attemptedAt < 60_000) return;
    attemptedAt = Date.now();
    const controller = new AbortController();
    active = controller;
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetcher(url, { signal: controller.signal, cache: "no-cache" });
      if (!response.ok) return;
      const calendar = parseCalendarPayload(await response.json());
      if (calendar && !stopped && !controller.signal.aborted) onCalendar(calendar);
    } catch {
      // A missing, malformed or temporarily unavailable file keeps the last good result.
    } finally {
      window.clearTimeout(timeout);
      if (active === controller) active = null;
    }
  };
  const foreground = () => { void refresh(); };
  void refresh();
  const timer = window.setInterval(foreground, 5 * 60_000);
  document.addEventListener("visibilitychange", foreground);
  window.addEventListener("focus", foreground);
  window.addEventListener("online", foreground);
  return () => {
    stopped = true;
    active?.abort();
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", foreground);
    window.removeEventListener("focus", foreground);
    window.removeEventListener("online", foreground);
  };
}
