import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  FULL_OPS_UI_URL,
  OPS_LOCAL_HEALTH_SCHEMA,
  readOpsLocalHealth,
  stripSecretKeys
} from "../server/admin-service/ops-local-health.ts";

describe("ops local health summary", () => {
  it("sanitizes dashboard+admin status.json and strips secrets", () => {
    const root = mkdtempSync(join(tmpdir(), "ops-health-"));
    try {
      mkdirSync(join(root, "dashboard"));
      mkdirSync(join(root, "admin"));
      writeFileSync(join(root, "dashboard", "status.json"), JSON.stringify({
        generatedAt: "2026-10-11T22:05:00+0800",
        overall: "alert",
        public: { ok: true, lagHours: 0.27, stale: false, level: "ok", httpCode: 200, url: "https://example.com", apiKey: "LEAK" },
        lastCycle: {
          ok: true,
          finishedAt: "2026-10-11T13:52:04.197Z",
          ageMinutes: 12.9,
          stale: false,
          level: "alert",
          refined: { ready: 2, failed: 38, skipped: 0 },
          site: { published: false, reason: "AWAITING_CONFIRMATION", items: 1500, commit: "abc" },
          sources: { ok: 20, failedCount: 1 }
        },
        launchAgents: {
          "com.f1plus1.lean": { loaded: true, state: "active", last_exit_code: 0, pid: 1, runs: 67, plist_exists: true }
        },
        rsshub: { ok: true, httpCode: 200, level: "ok", url: "http://127.0.0.1:1200/" },
        counts: { pending: 56, ready: 2067, held: 0, skipped: 746, failed: 2040, source: "x" },
        alerts: ["sources_failed_1"],
        warns: [],
        infos: [],
        secretToken: "nope"
      }));
      writeFileSync(join(root, "admin", "status.json"), JSON.stringify({
        generatedAt: "2026-10-11T22:05:02+0800",
        overall: "ok",
        mode: "local-whitelist-write",
        countsStore: { failed: 2049, pending: 55, ready: 2070, skipped: 747, total: 4921 },
        lastCycle: { finishedAt: "2026-10-11T13:52:04.197Z", refined: { ready: 2, failed: 38, skipped: 0 }, site: { published: false, reason: "AWAITING_CONFIRMATION" } },
        alerts: [],
        warns: [],
        infos: ["only safe"],
        notes: ["无密钥"],
        settings: { model: "glm", password: "x" },
        pendingList: [{ id: 1 }]
      }));

      const health = readOpsLocalHealth(root);
      expect(health.schemaVersion).toBe(OPS_LOCAL_HEALTH_SCHEMA);
      expect(health.fullOpsUi).toBe(FULL_OPS_UI_URL);
      expect(health.errors).toEqual([]);
      expect(health.dashboard?.overall).toBe("alert");
      expect(health.dashboard?.public).toMatchObject({ ok: true, lagHours: 0.27, level: "ok", httpCode: 200 });
      expect(health.dashboard?.public).not.toHaveProperty("url");
      expect(health.dashboard?.public).not.toHaveProperty("apiKey");
      expect(health.dashboard?.lastCycle).toMatchObject({
        refined: { ready: 2, failed: 38, skipped: 0 },
        site: { published: false, reason: "AWAITING_CONFIRMATION", items: 1500 }
      });
      expect(health.dashboard?.launchAgents).toMatchObject({
        "com.f1plus1.lean": { loaded: true, state: "active", lastExitCode: 0, runs: 67, plistExists: true }
      });
      expect((health.dashboard?.launchAgents as Record<string, Record<string, unknown>>)["com.f1plus1.lean"]).not.toHaveProperty("pid");
      expect(health.dashboard?.rsshub).toEqual({ ok: true, httpCode: 200, level: "ok" });
      expect(health.dashboard?.counts).toMatchObject({ pending: 56, ready: 2067, failed: 2040 });
      expect(health.dashboard?.alerts).toEqual(["sources_failed_1"]);
      expect(health.dashboard).not.toHaveProperty("secretToken");
      expect(health.admin?.overall).toBe("ok");
      expect(health.admin?.countsStore).toMatchObject({ ready: 2070, total: 4921 });
      expect(health.admin).not.toHaveProperty("settings");
      expect(health.admin).not.toHaveProperty("pendingList");
      expect(stripSecretKeys({ apiKey: "x", nested: { password: "y", ok: 1 } })).toEqual({ nested: { ok: 1 } });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reads live office ops status.json when present", () => {
    const health = readOpsLocalHealth("/Users/chanai/F1-1-website/ops");
    if (health.errors.length > 0 && health.dashboard === null) {
      expect(health.schemaVersion).toBe(OPS_LOCAL_HEALTH_SCHEMA);
      return;
    }
    expect(health.dashboard).not.toBeNull();
    expect(typeof health.dashboard?.overall).toBe("string");
    expect(health.dashboard?.lastCycle).toBeTruthy();
    expect(JSON.stringify(health)).not.toMatch(/password|apiKey|privateKey|credential/i);
  });
});
