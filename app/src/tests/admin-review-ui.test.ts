import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const service = readFileSync(new URL("../server/admin-service/bilingual-admin.ts", import.meta.url), "utf8");
const html = readFileSync(new URL("../admin-ui/index.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../admin-ui/app.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../admin-ui/app.css", import.meta.url), "utf8");

describe("Admin real operations observability MVP", () => {
  it("binds truthful overview fields, unavailable producers, DOM refresh, and mobile layout", () => {
    expect(service).toContain('schemaVersion: "admin-operations-overview-v1"');
    expect(service).toContain("generatedAt:");
    expect(service).toContain("processUptimeSeconds:");
    expect(service).toContain("control,");
    expect(service).toContain("byKind:");
    expect(service).toContain("byLifecycle:");
    expect(service).toContain("statusCounts: sourceStatusCounts");
    expect(service).toContain("outboxPending:");
    expect(service).toContain("outboxFailed:");
    expect(service).toContain("recentAuditEvents");
    expect(service).toContain("recentFailedOperations");
    expect([...service.matchAll(/LIMIT 20/gu)]).toHaveLength(2);

    expect(service).toContain("frontend: { status: \"unavailable\", reasonCode: \"PRODUCER_NOT_CONFIGURED\" }");
    for (const producer of ["trafficStats", "costTelemetry", "backups", "releaseHistory"]) {
      expect(service).toMatch(new RegExp(`${producer}: \\{ status: \"unavailable\", reasonCode: \"PRODUCER_NOT_CONFIGURED\" \\}`));
    }
    expect(service).toContain("backend: { status: \"available\" }");
    expect(service).toContain("adminApi: { status: \"available\" }");

    const operationIds = [
      "operations-generated",
      "operations-uptime",
      "operations-control",
      "operations-health",
      "operations-api-list",
      "operations-source-stats",
      "operations-outbox-pending",
      "operations-outbox-failed",
      "operations-outbox-transit",
      "operations-errors",
      "operations-audit-body",
      "operations-failure-body",
      "operations-producers",
      "source-registry-list"
    ];
    for (const id of operationIds) {
      expect(html, `missing #${id}`).toContain(`id="${id}"`);
      expect(script).toContain(`#${id}`);
    }

    expect(html).toContain('<h3 id="operations-title">来源与运行监控</h3>');
    expect(script).toContain("const OPERATIONS_REFRESH_MS = 15000");
    expect(script).toContain("!document.hidden && !state.busy");
    expect(script).toContain('document.addEventListener("visibilitychange"');
    expect(script).toContain('elements.operationsRefresh.addEventListener');
    expect(css).toMatch(/@media \(max-width:\s*760px\)/u);
    expect(css).toContain("grid-template-columns: minmax(0, 1fr)");

    expect(script).toContain('action === "disable" ? "暂停" : action === "requeue" ? "重新入队" : action === "enable" ? "启用" : "退役"');
    expect(script).toContain('"x-f1-fresh-reauth"');
  });
});
