import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../admin-ui/x-management.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../admin-ui/x-management.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../admin-ui/app.css", import.meta.url), "utf8");

describe("Admin X management UI wiring", () => {
  it("binds every referenced element to the dedicated management document", () => {
    const elementBlock = /const elements = Object\.freeze\(\{([\s\S]*?)\n  \}\);/.exec(script)?.[1] ?? "";
    const declaredNames = new Set([...elementBlock.matchAll(/^\s*(\w+):/gm)].map((match) => match[1]));
    const selectors = [...elementBlock.matchAll(/^\s*\w+:\s*document\.querySelector\("#([^\"]+)"\)/gm)];
    const usedNames = new Set([...script.matchAll(/elements\.(\w+)/g)].map((match) => match[1]));

    expect([...usedNames].filter((name) => !declaredNames.has(name))).toEqual([]);
    for (const [, id] of selectors) expect(html, `missing #${id}`).toContain(`id="${id}"`);
    expect(() => new Function(script)).not.toThrow();
  });

  it("provides real source and submission operations with closed metadata and recovery states", () => {
    expect(script).toContain('sources: "/api/admin/sources"');
    expect(script).toContain('submissions: "/api/admin/x-submissions"');
    expect(script).toContain('operationType, mutation');
    expect(script).toContain('"Idempotency-Key": idempotencyKey');
    expect(script).toContain('"X-CSRF-Token": csrfToken');
    expect(script).toContain('"X-F1-Fresh-Reauth": freshReceipt');
    expect(script).toContain('bodyWithoutMeta: { submittedUrl }');
    expect(script).toContain('bodyWithoutMeta: { reasonCode }');
    expect(script).toContain('submitManualUrl');
    expect(script).toContain('retireSubmission');
    expect(script).toContain('结果未知，请先刷新');
    expect(html).toContain('id="list-state"');
    expect(html).toContain('id="detail-state"');
    expect(html).toContain('id="submit-error"');
    expect(html).toContain('externalCalls=0');
    expect(script).not.toContain("resolve-oembed");
    expect(script).not.toContain("XManualSubmitLegacy");
  });

  it("keeps list/detail actions reachable on narrow touch screens", () => {
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*?html\[data-mobile-view="detail"\] \.x-admin-list-panel/);
    expect(css).toMatch(/\.x-submit-row \{[\s\S]*?flex-direction: column;/);
    expect(css).toMatch(/\.x-admin-detail-panel \.mobile-back \{[\s\S]*?display: inline-flex;/);
    expect(html).toContain('name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"');
  });
});
