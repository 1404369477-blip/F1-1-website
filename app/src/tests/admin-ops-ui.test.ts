import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../admin-ui/ops.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../admin-ui/ops.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../admin-ui/app.css", import.meta.url), "utf8");

describe("Admin ops pipeline UI wiring", () => {
  it("binds every referenced element to the ops document", () => {
    const elementBlock = /const elements = Object\.freeze\(\{([\s\S]*?)\n  \}\);/.exec(script)?.[1] ?? "";
    const declaredNames = new Set([...elementBlock.matchAll(/^\s*(\w+):/gm)].map((match) => match[1]));
    const selectors = [...elementBlock.matchAll(/^\s*\w+:\s*document\.querySelector\("#([^\"]+)"\)/gm)];
    const usedNames = new Set([...script.matchAll(/elements\.(\w+)/g)].map((match) => match[1]));

    expect([...usedNames].filter((name) => !declaredNames.has(name))).toEqual([]);
    for (const [, id] of selectors) expect(html, `missing #${id}`).toContain(`id="${id}"`);
    expect(() => new Function(script)).not.toThrow();
  });

  it("renders the five-station human pipeline with backup bypass and admin nav", () => {
    expect(html).toContain('id="ops-station-1"');
    expect(html).toContain('id="ops-station-2"');
    expect(html).toContain('id="ops-station-3"');
    expect(html).toContain('id="ops-station-4"');
    expect(html).toContain('id="ops-station-5"');
    expect(html).toContain("停在这里");
    expect(html).toContain("备份旁路");
    expect(html).toContain("访问旁路");
    expect(html).toContain("公开站计数器还没接线。这里不会显示 0 次访问。");
    expect(html).toContain('class="topbar-nav"');
    expect(html).not.toContain("x-admin-nav");
    expect(html).toContain('href="/admin/ops"');
    expect(html).toContain('href="/admin/reviews"');
    expect(html).toContain('href="/admin/sources"');
    expect(html).toContain(">信源</a>");
    expect(html).toContain('href="/admin/x-submissions"');
    expect(html).toContain('href="/admin/settings"');
    expect(html).toContain("自动审核和自动发布按设定关闭，不是故障。");
    expect(html).toContain("connect-src 'self'");
  });

  it("loads overview and recent-three with GET only and no write mutations", () => {
    expect(script).toContain('overview: "/api/admin/operations/overview"');
    expect(script).toContain('recentThree: "/api/admin/bilingual/recent-three"');
    expect(script).toContain('method: options.method ?? "GET"');
    expect(script).toContain("const OVERVIEW_REFRESH_MS = 15000");
    expect(script).toContain("publishBlocked");
    expect(script).toContain("waitingPublishCount");
    expect(script).not.toContain("resolve-oembed");
    expect(script).not.toContain("/api/admin/csrf");
    expect(script).not.toContain("fresh/verify");
    expect(script).not.toContain("X-CSRF-Token");
    expect(script).not.toContain("Idempotency-Key");
  });

  it("keeps the five-station track stacked on 390px-class viewports", () => {
    expect(css).toContain(".ops-track");
    expect(css).toMatch(/@media \(max-width: 800px\)[\s\S]*?\.ops-track[\s\S]*?grid-template-columns: 1fr/);
    expect(css).toMatch(/@media \(max-width: 800px\)[\s\S]*?\.ops-station[\s\S]*?grid-template-columns: 44px 1fr/);
    expect(html).toContain('name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"');
  });

  it("lets the pipeline column scroll instead of clipping the track", () => {
    expect(css).toMatch(/\.ops-wrap \{[\s\S]*?overflow-y: auto;/);
    expect(script).toContain("showUnreadPipeline");
    expect(script).toContain("先不要把下面当成现在的状态");
    expect(script).toContain("renderTraffic");
    expect(script).toContain("这里不会显示 0 次访问。");
  });
});

class OpsElement {
  textContent = "";
  innerHTML = "";
  className = "";
  hidden = false;
  title = "";
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  children: OpsElement[] = [];
  classList = { add() {}, remove() {} };
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  append(...children: OpsElement[]) { this.children.push(...children); }
  replaceChildren(...children: OpsElement[]) { this.children = children; }
  addEventListener() {}
}

async function opsHarness() {
  const elements = new Map<string, OpsElement>();
  const element = (selector: string) => {
    if (!elements.has(selector)) elements.set(selector, new OpsElement());
    return elements.get(selector)!;
  };
  element("#app-view").hidden = true;
  const intervals = new Map<number, () => void>();
  let nextTimer = 0;
  let failure: "network" | "session" | "hang" | "body-hang" | null = null;
  const timeouts = new Map<number, { callback: () => void; delay: number }>();
  const requestSignals: AbortSignal[] = [];
  let finishLate: (() => void) | null = null;
  const overview = {
    schemaVersion: "admin-operations-overview-v1",
    generatedAt: "2026-09-06T04:00:00.000Z",
    sources: { rssActive: 3 },
    pipeline: {
      collectionLive: true, lastPublishedAt: "2026-09-04T04:00:00.000Z",
      pendingReviewCount: 1, waitingPublishCount: 0, publishBlocked: false
    }
  };
  runInNewContext(script, {
    AbortController,
    document: {
      documentElement: element("html"), hidden: false,
      querySelector: element, createElement: () => new OpsElement(), addEventListener() {}
    },
    window: {
      fetch: async (path: string, options: { signal: AbortSignal }) => {
        requestSignals.push(options.signal);
        const payload = path.endsWith("overview") ? overview : { schemaVersion: "admin-bilingual-v1", items: [] };
        if (failure === "hang") return new Promise((resolve) => {
          const stalePayload = { ...overview, pipeline: { ...overview.pipeline, collectionLive: false } };
          finishLate = () => resolve({ ok: true, status: 200, json: async () => stalePayload });
        });
        if (failure === "body-hang") return {
          ok: true, status: 200, json: () => new Promise((resolve) => { finishLate = () => resolve(payload); })
        };
        if (failure === "network") throw new Error("offline");
        if (failure === "session") return {
          ok: false, status: 401, json: async () => ({ reasonCode: "ADMIN_SESSION_REQUIRED" })
        };
        return { ok: true, status: 200, json: async () => path.endsWith("overview")
          ? overview : { schemaVersion: "admin-bilingual-v1", items: [] } };
      },
      localStorage: { getItem: () => "dark", setItem() {} },
      matchMedia: () => ({ matches: false }),
      clearTimeout: (id: number) => { timeouts.delete(id); },
      setTimeout: (callback: () => void, delay: number) => { const id = ++nextTimer; timeouts.set(id, { callback, delay }); return id; },
      setInterval: (callback: () => void) => { const id = ++nextTimer; intervals.set(id, callback); return id; },
      clearInterval: (id: number) => { intervals.delete(id); }
    }
  });
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
  await settle();
  return {
    element, intervals, requestSignals, fail: (kind: typeof failure) => { failure = kind; },
    timeout: async () => {
      for (const [id, timer] of [...timeouts]) if (timer.delay === 10000) { timeouts.delete(id); timer.callback(); }
      await settle();
    },
    late: async () => { finishLate?.(); await settle(); },
    tick: async () => { for (const callback of [...intervals.values()]) callback(); await settle(); }
  };
}

describe("Admin ops running script failure recovery", () => {
  it("shows unknown data on a failed poll and recovers on the next successful poll", async () => {
    const page = await opsHarness();
    expect(page.element("#ops-flag-text").textContent).toBe("控制门已开");
    page.fail("network");
    await page.tick();
    expect(page.element("#ops-flag-text").textContent).toBe("读不到");
    expect(page.element("#connection-state").textContent).toBe("运行数据暂不可用");
    expect(page.element("#ops-metric-value").textContent).toBe("—");
    expect(page.element("#ops-days").children).toHaveLength(0);
    expect(page.intervals.size).toBe(1);
    page.fail(null);
    await page.tick();
    expect(page.element("#ops-flag-text").textContent).toBe("控制门已开");
    expect(page.element("#connection-state").textContent).toBe("私有会话已连接");
    expect(page.element("#ops-days").children).toHaveLength(8);
  });

  it.each(["hang", "body-hang"] as const)("bounds %s requests and recovers without a late response overwriting state", async (failure) => {
    const page = await opsHarness();
    page.fail(failure);
    await page.tick();
    const pendingSignal = page.requestSignals.at(-1)!;
    expect(pendingSignal.aborted).toBe(false);
    await page.timeout();
    expect(pendingSignal.aborted).toBe(true);
    expect(page.element("#ops-flag-text").textContent).toBe("读不到");
    expect(page.element("#toast").textContent).toContain("超时");
    page.fail(null);
    await page.tick();
    expect(page.element("#ops-flag-text").textContent).toBe("控制门已开");
    await page.late();
    expect(page.element("#ops-flag-text").textContent).toBe("控制门已开");
    expect(page.element("#connection-state").textContent).toBe("私有会话已连接");
  });

  it("returns an expired polling session to login and stops polling", async () => {
    const page = await opsHarness();
    page.fail("session");
    await page.tick();
    expect(page.element("#app-view").hidden).toBe(true);
    expect(page.element("#auth-view").hidden).toBe(false);
    expect(page.element("#connection-state").textContent).toBe("需要登录");
    expect(page.intervals.size).toBe(0);
  });

  it("marks only the recorded publication date and does not invent scheduler health", async () => {
    const page = await opsHarness();
    const days = page.element("#ops-days").children;
    expect(days.filter((day) => day.className === "ops-day is-filled")).toHaveLength(1);
    expect(days.filter((day) => day.className === "ops-day is-filled")[0].attributes["aria-label"])
      .toBe("9/4：有发布记录");
    expect(days.filter((day) => day.className === "ops-day is-empty").every((day) =>
      day.attributes["aria-label"].includes("未确认"))).toBe(true);
    expect(page.element("#ops-station-2-copy").textContent).toContain("采集运行待确认");
    expect(page.element("#ops-hero-copy").textContent).toContain("调度心跳");
    expect(html).toContain("灰柱表示逐日发布状态未确认");
  });
});
