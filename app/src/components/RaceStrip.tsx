"use client";

import { useEffect, useId, useState } from "react";

import { describeStrip, isDenseWindow, type F1Calendar, type StripView } from "../features/calendar/race-strip-model";
import { PUBLIC_STATIC_BASE_PATH } from "../features/stories/public-site-config";

function previewNow(): Date | null {
  if (typeof window === "undefined") return null;
  const host = window.location.hostname;
  if (host !== "localhost" && host !== "127.0.0.1") return null;
  const value = new URLSearchParams(window.location.search).get("now");
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function RaceStrip() {
  const panelId = useId();
  const [calendar, setCalendar] = useState<F1Calendar | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const path = `${PUBLIC_STATIC_BASE_PATH}/data/f1-calendar.json`;
    fetch(path, { signal: controller.signal, cache: "no-cache" })
      .then((response) => response.ok ? response.json() as Promise<F1Calendar> : null)
      .then((body) => {
        if (body && Array.isArray(body.races)) setCalendar(body);
      })
      .catch(() => { /* a missing file leaves the strip unrendered */ });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!calendar) return;
    const tick = () => setNow(previewNow() ?? new Date());
    tick();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") tick();
    }, 30_000);
    const onVisible = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVisible);
    const query = window.matchMedia("(max-width: 640px)");
    const onWidth = () => setMobile(query.matches);
    onWidth();
    query.addEventListener("change", onWidth);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      query.removeEventListener("change", onWidth);
    };
  }, [calendar]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!calendar || !now) return null;
  const view = describeStrip(calendar, now);
  if (!view) return null;
  return (
    <div className={`rs${open ? " is-open" : ""}`} data-dense={isDenseWindow(calendar, now) ? "yes" : "no"}>
      <button
        type="button"
        className="rs-bar"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="F1 赛程，北京时间，点击展开"
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          const scroller = event.currentTarget.closest("main");
          const top = scroller instanceof HTMLElement ? scroller.scrollTop : 0;
          setOpen((current) => !current);
          requestAnimationFrame(() => {
            if (scroller instanceof HTMLElement) scroller.scrollTop = top;
          });
        }}
      >
        <span className={`rs-mark rs-mark-${view.marker}`} aria-hidden="true" />
        <span className="rs-headline">{mobile ? view.mobileHeadline : view.headline}</span>
        {view.showTimeline ? <SessionDots view={view} /> : null}
        {view.meta ? <Meta text={view.meta} /> : null}
        <span className="rs-aside">
          {view.mobileAside ? <span>{view.mobileAside}</span> : null}
          <span className="rs-chev" aria-hidden="true">▾</span>
        </span>
      </button>
      {open ? <Panel id={panelId} view={view} /> : null}
    </div>
  );
}

function Meta({ text }: { text: string }) {
  const parts = text.split(" | ");
  return (
    <span className="rs-meta">
      {parts.map((part, index) => (
        <span key={part}>
          {index > 0 ? <span className="rs-meta-sep" /> : null}
          {part}
        </span>
      ))}
    </span>
  );
}
function SessionDots({ view }: { view: StripView }) {
  return (
    <span className="rs-timeline" aria-hidden="true">
      {view.sessions.map((session) => (
        <span key={session.key} className="rs-slot">
          <span className={`rs-pip is-${session.phase}`} title={session.title} />
          {session.phase === "live" || session.phase === "next" ? <span className="rs-pip-label">{session.short}</span> : null}
        </span>
      ))}
    </span>
  );
}

function Panel({ id, view }: { id: string; view: StripView }) {
  return (
    <div className="rs-panel" id={id}>
      <div>
        <p className="timeline-kicker rs-label">{view.panelTitle}{view.panelSprint ? " · 冲刺周末" : ""}</p>
        <ul className="rs-rows">
          {view.sessions.map((session) => (
            <li key={session.key} className={`rs-row is-${session.tone}`}>
              <span className="rs-name">{session.full}</span>
              <span className="rs-time">{session.timeLabel}</span>
              <span className={`rs-status${session.tone === "live" ? " is-live" : ""}`}>{session.statusLabel}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        {view.previous ? (
          <>
            <p className="timeline-kicker rs-label">上一站</p>
            <p className="rs-side-row"><span>{view.previous.nameZh}</span><span>{view.previous.dates}</span></p>
            <p className="rs-winner">{view.previous.winner === "成绩待更新" ? "成绩待更新" : `冠军 ${view.previous.winner}`}</p>
          </>
        ) : null}
        {view.upcoming.length > 0 ? (
          <>
            <p className="timeline-kicker rs-label">接下来</p>
            <ul className="rs-rows">
              {view.upcoming.map((race) => (
                <li key={race.round} className={`rs-side-row${race.status !== "scheduled" ? " is-cancelled" : ""}`}>
                  <span>
                    {race.nameZh}
                    {race.sprint ? <em className="rs-tag">冲刺</em> : null}
                    <em className="rs-round">第{race.round}轮</em>
                    {race.noteZh ? <em className="rs-note">{race.noteZh}</em> : null}
                    {race.status === "cancelled" ? " 已取消" : race.status === "postponed" ? " 延期" : ""}
                  </span>
                  <span className="rs-range">{race.dates}</span>
                  <span className="rs-race-time">{race.raceTime}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
      <p className="rs-foot">时间均为北京时间 (UTC+8) · 数据：Jolpica F1 API</p>
    </div>
  );
}
