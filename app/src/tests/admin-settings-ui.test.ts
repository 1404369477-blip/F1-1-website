import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, writeFileSync, realpathSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import {
  prepareRefinementModelMutation,
  readRefinementModelSettings,
  refinementModelKeyPresent,
  writeRefinementModelSettings
} from "../server/admin-service/refinement-model-settings.ts";
import { canonicalJson } from "../server/db/profile.ts";

const temporaryRoots: string[] = [];
const deepseekFixtureKey = `sk-${"D".repeat(24)}`;
const glmFixtureKey = `${"G".repeat(20)}.${"g".repeat(12)}`;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function tempPrivate(): string {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "f1-settings-"));
  chmodSync(root, 0o700);
  temporaryRoots.push(root);
  return root;
}

afterAll(() => { for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true }); });

describe("refinement model settings", () => {
  it("defaults to deepseek-chat with updatedAt null when the config file is missing", () => {
    const privateDir = tempPrivate();
    const snapshot = readRefinementModelSettings(privateDir);
    expect(snapshot.schemaVersion).toBe("admin-refinement-model-v1");
    expect(snapshot.current.modelId).toBe("deepseek-chat");
    expect(snapshot.current.displayName).toBe("DeepSeek Chat");
    expect(snapshot.updatedAt).toBeNull();
    expect(snapshot.catalog.map((item) => item.modelId)).toEqual(["deepseek-chat", "glm-5.3-flash"]);
    expect(snapshot.catalog[1]?.endpointHost).toBe("open.bigmodel.cn");
    expect(snapshot.catalog[0]?.endpointHost).toBe("api.deepseek.com");
    expect(snapshot.catalog[1]?.persistSupported).toBe(false);
  });

  it("reports valid private key files without returning key bytes or claiming a connection check", () => {
    const privateDir = tempPrivate();
    expect(refinementModelKeyPresent(privateDir, "glm-5.3-flash")).toBe(false);
    writeFileSync(join(privateDir, "glm-api-key"), glmFixtureKey, { mode: 0o600 });
    expect(refinementModelKeyPresent(privateDir, "glm-5.3-flash")).toBe(true);
    expect(readRefinementModelSettings(privateDir).catalog.find((item) => item.modelId === "glm-5.3-flash")?.keyPresent).toBe(true);
    expect(JSON.stringify(readRefinementModelSettings(privateDir))).not.toContain(glmFixtureKey);
  });

  it.each(["empty", "malformed", "directory", "symlink", "hardlink", "wide-permissions", "oversized"])("does not report %s as a configured key", (kind) => {
    const privateDir = tempPrivate();
    const path = join(privateDir, "deepseek-api-key");
    if (kind === "directory") mkdirSync(path, { mode: 0o700 });
    else if (kind === "symlink" || kind === "hardlink") {
      const target = join(privateDir, "fixture-key");
      writeFileSync(target, deepseekFixtureKey, { mode: 0o600 });
      if (kind === "symlink") symlinkSync(target, path); else linkSync(target, path);
    } else {
      writeFileSync(path, kind === "empty" ? "" : kind === "malformed" ? "not-a-key" : kind === "oversized" ? `${deepseekFixtureKey}${" ".repeat(2048)}` : deepseekFixtureKey, { mode: 0o600 });
      if (kind === "wide-permissions") chmodSync(path, 0o644);
    }
    const before = lstatSync(path);
    expect(refinementModelKeyPresent(privateDir, "deepseek-chat")).toBe(false);
    expect(readRefinementModelSettings(privateDir).current.keyPresent).toBe(false);
    expect(lstatSync(path).mode).toBe(before.mode);
  });

  it("writes a closed config file and returns the saved snapshot", () => {
    const privateDir = tempPrivate();
    writeFileSync(join(privateDir, "deepseek-api-key"), deepseekFixtureKey, { mode: 0o600 });
    const snapshot = writeRefinementModelSettings(privateDir, "deepseek-chat", "2026-09-01T01:02:03.000Z");
    expect(snapshot.current.modelId).toBe("deepseek-chat");
    expect(snapshot.updatedAt).toBe("2026-09-01T01:02:03.000Z");
    expect(readRefinementModelSettings(privateDir).updatedAt).toBe("2026-09-01T01:02:03.000Z");
  });

  it("rejects unsupported persistence without creating or changing the config file", () => {
    const privateDir = tempPrivate();
    writeFileSync(join(privateDir, "glm-api-key"), glmFixtureKey, { mode: 0o600 });
    const path = join(privateDir, "refinement-model.json");
    expect(() => writeRefinementModelSettings(privateDir, "glm-5.3-flash", "2026-09-01T01:02:03.000Z")).toThrow("REFINEMENT_MODEL_UNSUPPORTED");
    expect(existsSync(path)).toBe(false);
    writeRefinementModelSettings(privateDir, "deepseek-chat", "2026-09-01T01:02:03.000Z");
    const before = readFileSync(path);
    const beforeStat = lstatSync(path);
    expect(() => writeRefinementModelSettings(privateDir, "glm-5.3-flash", "2026-09-02T01:02:03.000Z")).toThrow("REFINEMENT_MODEL_UNSUPPORTED");
    expect(readFileSync(path)).toEqual(before);
    expect(lstatSync(path).mtimeMs).toBe(beforeStat.mtimeMs);
  });

  it("binds requestHash to the settings path", () => {
    const unsigned = {
      schemaVersion: "admin-refinement-model-v1",
      modelId: "deepseek-chat",
      idempotencyKey: "refine-model_abc",
      clientRequestId: "refine-model-client_abc"
    };
    const requestHash = sha256(canonicalJson({
      method: "POST",
      canonicalPath: "/api/admin/settings/refinement-model",
      body: unsigned
    }));
    const prepared = prepareRefinementModelMutation({ ...unsigned, requestHash });
    expect(prepared.binding.path).toBe("/api/admin/settings/refinement-model");
    expect(prepared.binding.method).toBe("POST");
    expect(prepared.mutation.modelId).toBe("deepseek-chat");
  });
});

