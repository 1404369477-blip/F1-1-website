import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

type Page = Readonly<{
  name: string;
  html: string;
  script: string;
}>;

const pages: readonly Page[] = [
  {
    name: "reviews",
    html: readFileSync(new URL("../admin-ui/index.html", import.meta.url), "utf8"),
    script: readFileSync(new URL("../admin-ui/app.js", import.meta.url), "utf8")
  },
  {
    name: "ops",
    html: readFileSync(new URL("../admin-ui/ops.html", import.meta.url), "utf8"),
    script: readFileSync(new URL("../admin-ui/ops.js", import.meta.url), "utf8")
  },
  {
    name: "sources",
    html: readFileSync(new URL("../admin-ui/sources.html", import.meta.url), "utf8"),
    script: readFileSync(new URL("../admin-ui/sources.js", import.meta.url), "utf8")
  },
  {
    name: "x-management",
    html: readFileSync(new URL("../admin-ui/x-management.html", import.meta.url), "utf8"),
    script: readFileSync(new URL("../admin-ui/x-management.js", import.meta.url), "utf8")
  },
  {
    name: "settings",
    html: readFileSync(new URL("../admin-ui/settings.html", import.meta.url), "utf8"),
    script: readFileSync(new URL("../admin-ui/settings.js", import.meta.url), "utf8")
  }
];

function buttonTags(html: string): readonly string[] {
  return html.match(/<button\b[\s\S]*?<\/button>/g) ?? [];
}

function idOf(tag: string): string | undefined {
  return /id="([^"]+)"/.exec(tag)?.[1];
}

function hasDisabled(tag: string): boolean {
  return /\sdisabled(?:\s|>|=)/.test(tag);
}

function boundIds(script: string): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const match of script.matchAll(/querySelector\("#([^"]+)"\)/g)) ids.add(match[1]);
  for (const match of script.matchAll(/getElementById\("([^"]+)"\)/g)) ids.add(match[1]);
  return ids;
}

describe("Admin UI button inventory", () => {
  it("accounts for every static button on reviews, ops, sources, X, and settings pages", () => {
    const leftover: string[] = [];
    for (const page of pages) {
      const bound = boundIds(page.script);
      for (const tag of buttonTags(page.html)) {
        const id = idOf(tag);
        const role = /role="tab"/.test(tag);
        const dataAction = /data-(?:language-tab|authority-capability)=/.test(tag);
        const formSubmit = /type="submit"/.test(tag);
        if (id && (bound.has(id) || page.script.includes(`"${id}"`) || page.script.includes(`#${id}`))) continue;
        if (hasDisabled(tag) && !id) continue;
        if (role || dataAction || formSubmit) continue;
        leftover.push(`${page.name}:${id ?? tag.slice(0, 80)}`);
      }
    }
    expect(leftover).toEqual([]);
  });

  it("keeps ops and sources as GET-only after login (no write buttons)", () => {
    const ops = pages.find((page) => page.name === "ops")!;
    const sources = pages.find((page) => page.name === "sources")!;
    for (const page of [ops, sources]) {
      const ids = buttonTags(page.html).map((tag) => idOf(tag)).filter((value): value is string => Boolean(value));
      expect(ids.sort()).toEqual(["login-passkey", "theme-toggle"]);
      expect(page.script).not.toContain("X-CSRF-Token");
      expect(page.script).not.toContain("fresh/verify");
      expect(page.script).not.toContain("Idempotency-Key");
    }
  });

  it("keeps review mutation controls behind named handlers or disabled placeholders", () => {
    const reviews = pages.find((page) => page.name === "reviews")!;
    expect(reviews.script).toContain("batchRelease");
    expect(reviews.script).toContain("saveRevision");
    expect(reviews.script).toContain("activateAuthority");
    expect(reviews.html).toContain("通过并发布");
    expect(reviews.html).toContain('id="publish-gate-notice"');
    expect(reviews.html).toContain('class="topbar-nav"');
    expect(reviews.script).toContain("PUBLICATION_RECONCILE_WAIT");
    expect(reviews.html).toContain('id="publish-gate-notice"');
    expect(reviews.html).toContain('class="topbar-nav"');
    expect(reviews.script).toContain("PUBLICATION_RECONCILE_WAIT");
    expect(reviews.html).toContain("保存并生成待审核版本");
    expect(reviews.html).toMatch(/<button type="button" disabled>批准<\/button>/);
    expect(reviews.html).toMatch(/<button type="button" disabled>拒绝<\/button>/);
    expect(reviews.html).toMatch(/<button type="button" disabled>发布<\/button>/);
    expect(reviews.html).toMatch(/<button type="button" disabled>撤回<\/button>/);
    expect(reviews.html).toContain('data-authority-capability="bilingual_auto_refine" disabled');
    expect(reviews.html).toContain('data-authority-capability="source_registry_management" disabled');
  });

  it("keeps X write actions on the dedicated page with CSRF and fresh re-auth", () => {
    const x = pages.find((page) => page.name === "x-management")!;
    expect(x.html).toContain('id="submit-url"');
    expect(x.html).toContain('id="retire-confirm"');
    expect(x.script).toContain("submitManualUrl");
    expect(x.script).toContain("retireSubmission");
    expect(x.script).toContain('"X-CSRF-Token"');
    expect(x.script).toContain('"X-F1-Fresh-Reauth"');
  });

  it("keeps settings writes on CSRF then the closed refinement-model POST", () => {
    const settings = pages.find((page) => page.name === "settings")!;
    expect(settings.html).toContain('id="settings-save"');
    expect(settings.html).toContain('value="deepseek-chat"');
    expect(settings.html).toContain('value="glm-5.3-flash"');
    expect(settings.script).toContain('"X-CSRF-Token"');
    expect(settings.script).toContain('"Idempotency-Key"');
    expect(settings.script).toContain("/api/admin/settings/refinement-model");
    expect(settings.script).not.toContain("fresh/verify");
  });
});
