import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../admin-ui/sources.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../admin-ui/sources.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../admin-ui/app.css", import.meta.url), "utf8");

describe("Admin source roster UI wiring", () => {
  it("binds every referenced element to the sources document", () => {
    const elementBlock = /const elements = Object\.freeze\(\{([\s\S]*?)\n  \}\);/.exec(script)?.[1] ?? "";
    const declaredNames = new Set([...elementBlock.matchAll(/^\s*(\w+):/gm)].map((match) => match[1]));
    const selectors = [...elementBlock.matchAll(/^\s*\w+:\s*document\.querySelector\("#([^\"]+)"\)/gm)];
    const usedNames = new Set([...script.matchAll(/elements\.(\w+)/g)].map((match) => match[1]));

    expect([...usedNames].filter((name) => !declaredNames.has(name))).toEqual([]);
    for (const [, id] of selectors) expect(html, `missing #${id}`).toContain(`id="${id}"`);
    expect(() => new Function(script)).not.toThrow();
  });

  it("renders dual-track news and X directory copy with admin nav", () => {
    expect(html).toContain("新闻网站");
    expect(html).toContain("车手 X");
    expect(html).toContain("可以进流水线");
    expect(html).toContain("只是通讯录");
    expect(html).toContain("车手账号还没进入正式名单。选定了也不等于已经在采。");
    expect(html).toContain("不会轮询、搜索或走非官方接口。");
    expect(html).toContain('href="/admin/x-accounts"');
    expect(html).toContain('href="/admin/ops"');
    expect(html).toContain('href="/admin/reviews"');
    expect(html).toContain('href="/admin/settings"');
    expect(html).toContain(">信源</a>");
    expect(html).toContain('class="topbar-nav"');
    expect(html).not.toContain("x-admin-nav");
    expect(html).toContain("connect-src 'self'");
  });

  it("loads registry and X directory with GET only and no write mutations", () => {
    expect(script).toContain('sources: "/api/admin/sources"');
    expect(script).toContain('xSources: "/api/admin/x-sources"');
    expect(script).toContain('overview: "/api/admin/operations/overview"');
    expect(script).toContain('method: options.method ?? "GET"');
    expect(script).toContain("showUnreadRoster");
    expect(script).toContain("先不要把下面当成现在的状态");
    expect(script).toContain("通讯录 · 未采集");
    expect(script).not.toContain("resolve-oembed");
    expect(script).not.toContain("/api/admin/csrf");
    expect(script).not.toContain("fresh/verify");
    expect(script).not.toContain("X-CSRF-Token");
    expect(script).not.toContain("Idempotency-Key");
  });

  it("stacks the two source lanes on 390px-class viewports", () => {
    expect(css).toContain(".ops-lanes");
    expect(css).toMatch(/@media \(max-width: 800px\)[\s\S]*?\.ops-lanes[\s\S]*?grid-template-columns: 1fr/);
    expect(html).toContain('name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"');
  });
});
