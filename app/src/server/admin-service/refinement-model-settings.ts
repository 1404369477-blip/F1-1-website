import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { atomicWritePrivateFile, readPrivateFile, withPrivateFileLock } from "../rss/private-credential-file.ts";
import { basename, join, resolve } from "node:path";

import { z } from "zod";

import { canonicalJson } from "../db/profile.ts";
import { ReviewRealError } from "../review-real/error.ts";
import type { ReviewMutationBinding } from "../review-real/security.ts";
import {
  DEFAULT_REFINE_MODEL_ID,
  REFINE_MODEL_IDS,
  REFINEMENT_MODEL_SCHEMA_VERSION,
  readRefinementModelConfig,
  refineModelById,
  type RefineModelId
} from "../rss/refine-model.ts";

export const ADMIN_REFINEMENT_MODEL_SCHEMA = "admin-refinement-model-v1" as const;
export const REFINEMENT_MODEL_CONFIG_FILE = "refinement-model.json" as const;

const IdSchema = z.string().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
const HashSchema = z.string().regex(/^[0-9a-f]{64}$/);

const DISPLAY_NAMES: Readonly<Record<RefineModelId, string>> = Object.freeze({
  "deepseek-chat": "DeepSeek Chat",
  "glm-5.3-flash": "GLM 5.3 Flash"
});

export const RefinementModelMutationSchema = z.object({
  schemaVersion: z.literal(ADMIN_REFINEMENT_MODEL_SCHEMA),
  modelId: z.enum(REFINE_MODEL_IDS),
  idempotencyKey: IdSchema,
  clientRequestId: IdSchema,
  requestHash: HashSchema
}).strict();

export type RefinementModelMutation = z.infer<typeof RefinementModelMutationSchema>;

export type RefinementModelCatalogItem = Readonly<{
  modelId: RefineModelId;
  displayName: string;
  endpointHost: string;
  keyPresent: boolean;
  persistSupported: boolean;
}>;

export type RefinementModelSettingsSnapshot = Readonly<{
  schemaVersion: typeof ADMIN_REFINEMENT_MODEL_SCHEMA;
  current: {
    modelId: RefineModelId;
    displayName: string;
    keyPresent: boolean;
    persistSupported: boolean;
  };
  catalog: readonly RefinementModelCatalogItem[];
  updatedAt: string | null;
}>;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function endpointHost(endpoint: string): string {
  return new URL(endpoint).hostname;
}

function configPath(privateDir: string): string {
  const resolved = resolve(privateDir);
  if (resolved !== privateDir) throw new ReviewRealError("ADMIN_REQUEST_INVALID", 400);
  return join(resolved, REFINEMENT_MODEL_CONFIG_FILE);
}

function keyPath(privateDir: string, modelId: RefineModelId): string {
  const fileName = refineModelById(modelId).keyFileName;
  if (basename(fileName) !== fileName) throw new ReviewRealError("ADMIN_INTERNAL_FAILURE", 500);
  return join(resolve(privateDir), fileName);
}

function keyPresent(privateDir: string, modelId: RefineModelId): boolean {
  try {
    const file = readPrivateFile(keyPath(privateDir, modelId), 1024);
    return file !== null && refineModelById(modelId).apiKeyPattern.test(file.text.trim());
  } catch { return false; }
}

export function refinementModelPersistSupported(modelId: RefineModelId): boolean {
  return refineModelById(modelId).persistMachineSummaryDraft;
}

function catalogItem(privateDir: string, modelId: RefineModelId): RefinementModelCatalogItem {
  const model = refineModelById(modelId);
  return Object.freeze({
    modelId,
    displayName: DISPLAY_NAMES[modelId],
    endpointHost: endpointHost(model.endpoint),
    keyPresent: keyPresent(privateDir, modelId),
    persistSupported: model.persistMachineSummaryDraft
  });
}

export function readRefinementModelSettings(privateDir: string): RefinementModelSettingsSnapshot {
  const path = configPath(privateDir);
  const configPresent = existsSync(path);
  const config = readRefinementModelConfig(path);
  const current = catalogItem(privateDir, config.modelId);
  return Object.freeze({
    schemaVersion: ADMIN_REFINEMENT_MODEL_SCHEMA,
    current: Object.freeze({
      modelId: current.modelId,
      displayName: current.displayName,
      keyPresent: current.keyPresent,
      persistSupported: current.persistSupported
    }),
    catalog: Object.freeze(REFINE_MODEL_IDS.map((modelId) => catalogItem(privateDir, modelId))),
    updatedAt: configPresent ? config.updatedAt : null
  });
}

export function writeRefinementModelSettings(
  privateDir: string,
  modelId: RefineModelId,
  updatedAt: string
): RefinementModelSettingsSnapshot {
  if (!refinementModelPersistSupported(modelId)) throw new Error("REFINEMENT_MODEL_UNSUPPORTED");
  const path = configPath(privateDir);
  withPrivateFileLock(`${path}.lock`, () => {
    const previous = readPrivateFile(path, 4096);
    atomicWritePrivateFile(path, `${JSON.stringify({ schemaVersion: REFINEMENT_MODEL_SCHEMA_VERSION, modelId, updatedAt })}\n`, previous?.identity ?? null, 4096);
  });
  return readRefinementModelSettings(privateDir);
}

export function refinementModelKeyPresent(privateDir: string, modelId: RefineModelId): boolean {
  return keyPresent(privateDir, modelId);
}

export function prepareRefinementModelMutation(value: unknown): Readonly<{
  mutation: RefinementModelMutation;
  binding: ReviewMutationBinding;
}> {
  const parsed = RefinementModelMutationSchema.safeParse(value);
  if (!parsed.success) throw new ReviewRealError("ADMIN_REQUEST_INVALID", 400);
  const mutation = parsed.data;
  const path = "/api/admin/settings/refinement-model";
  const { requestHash: _requestHash, ...unsigned } = mutation;
  if (mutation.requestHash !== sha256(canonicalJson({ method: "POST", canonicalPath: path, body: unsigned }))) {
    throw new ReviewRealError("ADMIN_REQUEST_INVALID", 400);
  }
  return Object.freeze({
    mutation,
    binding: Object.freeze({
      method: "POST" as const,
      path,
      operationId: `refine_model_${sha256(mutation.idempotencyKey).slice(0, 32)}`,
      bodyHash: sha256(canonicalJson(mutation))
    })
  });
}

export function defaultRefinementModelId(): RefineModelId {
  return DEFAULT_REFINE_MODEL_ID;
}
