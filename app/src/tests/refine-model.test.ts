import {
  chmodSync,
  mkdtempSync,
  writeFileSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_REFINE_MODEL_ID,
  GLM_API_KEY_PATTERN,
  readRefineModelApiKey,
  readRefinementModelConfig,
  REFINE_MODEL_CATALOG,
  refineModelById,
} from "../server/rss/refine-model.ts";

function tempRoot(): string {
  return mkdtempSync(join(realpathSync(tmpdir()), "f1-refine-model-"));
}

describe("refinement model catalog", () => {
  it("defaults to deepseek-chat when the config file is missing", () => {
    const path = join(tempRoot(), "missing", "refinement-model.json");
    expect(readRefinementModelConfig(path)).toMatchObject({
      schemaVersion: "refinement-model-v1",
      modelId: "deepseek-chat",
    });
    expect(DEFAULT_REFINE_MODEL_ID).toBe("deepseek-chat");
  });

  it("fails closed on invalid JSON", () => {
    const path = join(tempRoot(), "refinement-model.json");
    writeFileSync(path, "{", { mode: 0o600 });
    expect(() => readRefinementModelConfig(path)).toThrow(
      "REFINEMENT_MODEL_CONFIG_INVALID",
    );
  });

  it("fails closed on an unknown model id", () => {
    const path = join(tempRoot(), "refinement-model.json");
    writeFileSync(
      path,
      JSON.stringify({
        schemaVersion: "refinement-model-v1",
        modelId: "gpt-4",
        updatedAt: "2026-09-01T00:00:00.000Z",
      }),
      { mode: 0o600 },
    );
    expect(() => readRefinementModelConfig(path)).toThrow(
      "REFINEMENT_MODEL_CONFIG_INVALID",
    );
  });

  it("fails closed on additional properties", () => {
    const path = join(tempRoot(), "refinement-model.json");
    writeFileSync(
      path,
      JSON.stringify({
        schemaVersion: "refinement-model-v1",
        modelId: "deepseek-chat",
        updatedAt: "2026-09-01T00:00:00.000Z",
        extra: true,
      }),
      { mode: 0o600 },
    );
    expect(() => readRefinementModelConfig(path)).toThrow(
      "REFINEMENT_MODEL_CONFIG_INVALID",
    );
  });

  it("accepts a closed glm-5.3-flash config", () => {
    const path = join(tempRoot(), "refinement-model.json");
    writeFileSync(
      path,
      JSON.stringify({
        schemaVersion: "refinement-model-v1",
        modelId: "glm-5.3-flash",
        updatedAt: "2026-09-01T08:00:00.000Z",
      }),
      { mode: 0o600 },
    );
    expect(readRefinementModelConfig(path)).toEqual({
      schemaVersion: "refinement-model-v1",
      modelId: "glm-5.3-flash",
      updatedAt: "2026-09-01T08:00:00.000Z",
    });
  });

  it("keeps a closed DeepSeek vs GLM catalog", () => {
    const deepseek = refineModelById("deepseek-chat");
    const glm = refineModelById("glm-5.3-flash");
    expect(deepseek).toMatchObject({
      endpoint: "https://api.deepseek.com/chat/completions",
      keyFileName: "deepseek-api-key",
      routeId: "route-deepseek",
      persistMachineSummaryDraft: true,
      idempotencyPrefix: "deepseek",
    });
    expect(glm).toMatchObject({
      endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
      keyFileName: "glm-api-key",
      routeId: "route-glm",
      persistMachineSummaryDraft: false,
      idempotencyPrefix: "glm",
    });
    expect(glm.idempotencyPrefix.includes("/")).toBe(false);
    expect(deepseek.idempotencyPrefix.includes("/")).toBe(false);
    expect(REFINE_MODEL_CATALOG["glm-5.3-flash"].modelId).toBe("glm-5.3-flash");
    expect(() => refineModelById("gpt-4")).toThrow("REFINE_MODEL_UNKNOWN");
  });

  it("fails closed on a mismatched GLM key and does not treat DeepSeek keys as GLM keys", () => {
    const root = tempRoot();
    const glmPath = join(root, "glm-api-key");
    const deepseekPath = join(root, "deepseek-api-key");
    writeFileSync(glmPath, `sk-${"x".repeat(30)}`, { mode: 0o600 });
    chmodSync(glmPath, 0o600);
    writeFileSync(deepseekPath, `sk-${"x".repeat(30)}`, { mode: 0o600 });
    chmodSync(deepseekPath, 0o600);
    expect(() => readRefineModelApiKey(glmPath, "glm-5.3-flash")).toThrow(
      "GLM_API_KEY_INVALID",
    );
    expect(readRefineModelApiKey(deepseekPath, "deepseek-chat")).toBe(
      `sk-${"x".repeat(30)}`,
    );
    expect(GLM_API_KEY_PATTERN.test(`${"a".repeat(32)}.${"b".repeat(16)}`)).toBe(
      true,
    );
    const validGlmPath = join(root, "glm-api-key-valid");
    writeFileSync(validGlmPath, `${"a".repeat(32)}.${"b".repeat(16)}`, {
      mode: 0o600,
    });
    expect(readRefineModelApiKey(validGlmPath, "glm-5.3-flash")).toBe(
      `${"a".repeat(32)}.${"b".repeat(16)}`,
    );
  });
});
