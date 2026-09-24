import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { canonicalJson } from "../db/profile.ts";
import { ReviewRealError } from "../review-real/error.ts";
import { ReviewAdminSecurity, type ReviewMutationBinding } from "../review-real/security.ts";
import { REFINE_MODEL_IDS, refineModelById, type RefineModelId } from "../rss/refine-model.ts";
import { atomicWritePrivateFile, PrivateFileCommitError, readPrivateFile, withPrivateFileLock, type PrivateFile } from "../rss/private-credential-file.ts";
import { singleRawHeader, type RawAdminContext } from "../source-management/security.ts";
import { probeModelProvider, type ModelProviderProbe } from "./model-provider-probe.ts";

export const MODEL_CREDENTIALS_PATH = "/api/admin/settings/model-credentials";
export const MODEL_CREDENTIALS_SCHEMA = "admin-model-credentials-v1";
const IdSchema = z.string().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
const HashSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const ModelCredentialMutationSchema = z.object({
  schemaVersion: z.literal("admin-model-credential-mutation-v1"), modelId: z.enum(REFINE_MODEL_IDS),
  expectedRevision: HashSchema.nullable(), action: z.enum(["test", "replaceKey"]),
  apiKey: z.string().min(1).max(1024).optional(), idempotencyKey: IdSchema, clientRequestId: IdSchema, requestHash: HashSchema
}).strict().superRefine((value, context) => {
  if (value.action === "replaceKey" && value.apiKey === undefined) context.addIssue({ code: "custom", message: "input required" });
});
export type ModelCredentialMutation = z.infer<typeof ModelCredentialMutationSchema>;
export type CredentialValidation = Readonly<{ status: "unverified" | "verified" | "failed"; checkedAt: string | null; reasonCode: string | null }>;
export type ModelCredentialSnapshot = Readonly<{
  modelId: RefineModelId; displayName: string; endpointHost: string; persistSupported: boolean; keyConfigured: boolean;
  revision: string | null; keyUpdatedAt: string | null; validation: CredentialValidation; lastOperationId: string | null;
}>;
const MetadataSchema = z.object({
  schemaVersion: z.literal("model-credential-metadata-v1"), revision: HashSchema,
  keyUpdatedAt: z.string().datetime(), lastOperationId: IdSchema,
  validation: z.object({ status: z.enum(["verified", "failed"]), checkedAt: z.string().datetime(), reasonCode: z.string().regex(/^CREDENTIAL_[A-Z_]+$/).nullable() }).strict()
}).strict();
const UNVERIFIED: CredentialValidation = Object.freeze({ status: "unverified", checkedAt: null, reasonCode: null });
const hash = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

export function prepareModelCredentialMutation(value: unknown): Readonly<{ mutation: ModelCredentialMutation; binding: ReviewMutationBinding & { freshAction: "MODEL_CREDENTIAL"; resourceHash: string } }> {
  const parsed = ModelCredentialMutationSchema.safeParse(value);
  if (!parsed.success) throw new ReviewRealError("ADMIN_REQUEST_INVALID", 400);
  const mutation = parsed.data;
  const { requestHash, ...unsigned } = mutation;
  if (requestHash !== hash(canonicalJson({ method: "POST", canonicalPath: MODEL_CREDENTIALS_PATH, body: unsigned }))) throw new ReviewRealError("ADMIN_REQUEST_INVALID", 400);
  const bodyHash = hash(canonicalJson(mutation));
  return { mutation, binding: { method: "POST", path: MODEL_CREDENTIALS_PATH,
    operationId: `credential_${hash(mutation.idempotencyKey).slice(0, 32)}`, bodyHash,
    freshAction: "MODEL_CREDENTIAL", resourceHash: hash(canonicalJson({ modelId: mutation.modelId, action: mutation.action, expectedRevision: mutation.expectedRevision, bodyHash })) } };
}

/** Raw key files remain the worker authority; metadata is valid only for the same opaque revision. */
export class ModelCredentialStore {
  constructor(private readonly privateDir: string, private readonly security: ReviewAdminSecurity) {
    if (resolve(privateDir) !== privateDir) throw new Error("CREDENTIAL_STORAGE_UNSAFE");
  }
  keyPath(modelId: RefineModelId): string { return join(this.privateDir, refineModelById(modelId).keyFileName); }
  private metadataPath(modelId: RefineModelId): string { return `${this.keyPath(modelId)}.metadata.json`; }
  readKey(modelId: RefineModelId): PrivateFile | null { return readPrivateFile(this.keyPath(modelId), 1024); }
  assertWriteReady(modelId: RefineModelId): void {
    try { lstatSync(`${this.keyPath(modelId)}.lock`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") { readPrivateFile(this.metadataPath(modelId), 4096); return; } throw error; }
    throw new Error("CREDENTIAL_BUSY");
  }
  revision(modelId: RefineModelId, key: PrivateFile | null): string | null {
    return key === null ? null : this.security.modelCredentialRevision(`${modelId}\n${key.revisionInput}`);
  }
  read(modelId: RefineModelId): ModelCredentialSnapshot {
    const model = refineModelById(modelId);
    let key: PrivateFile | null = null;
    try { key = this.readKey(modelId); } catch { /* invalid storage is never called configured */ }
    const revision = this.revision(modelId, key);
    const keyConfigured = key !== null && model.apiKeyPattern.test(key.text.trim());
    let metadata: z.infer<typeof MetadataSchema> | null = null;
    try {
      const file = readPrivateFile(this.metadataPath(modelId), 4096);
      const parsed = file === null ? null : MetadataSchema.safeParse(JSON.parse(file.text));
      if (parsed?.success && parsed.data.revision === revision && keyConfigured) metadata = parsed.data;
    } catch { /* mismatched or incomplete metadata conveys no successful operation */ }
    return Object.freeze({ modelId, displayName: modelId === "deepseek-chat" ? "DeepSeek Chat" : "GLM 5.3 Flash",
      endpointHost: new URL(model.endpoint).hostname, persistSupported: model.persistMachineSummaryDraft,
      keyConfigured, revision, keyUpdatedAt: metadata?.keyUpdatedAt ?? key?.modifiedAt ?? null,
      validation: metadata?.validation ?? UNVERIFIED, lastOperationId: metadata?.lastOperationId ?? null });
  }
  snapshot() { return { schemaVersion: MODEL_CREDENTIALS_SCHEMA, providers: REFINE_MODEL_IDS.map(modelId => this.read(modelId)) }; }
  commit(input: Readonly<{ mutation: ModelCredentialMutation; operationId: string; original: PrivateFile | null; validation: CredentialValidation; now: string }>): ModelCredentialSnapshot {
    const { mutation, operationId, original, validation, now } = input;
    return withPrivateFileLock(`${this.keyPath(mutation.modelId)}.lock`, () => {
      const current = this.readKey(mutation.modelId);
      if ((current?.identity ?? null) !== (original?.identity ?? null) || this.revision(mutation.modelId, current) !== mutation.expectedRevision) throw new Error("CREDENTIAL_REVISION_CONFLICT");
      const metadataPath = this.metadataPath(mutation.modelId);
      // Validate the metadata destination before touching the authoritative key.
      const oldMetadata = readPrivateFile(metadataPath, 4096);
      let replaced = false;
      try {
        if (mutation.action === "replaceKey") {
          atomicWritePrivateFile(this.keyPath(mutation.modelId), `${mutation.apiKey!.trim()}\n`, original?.identity ?? null, 1024);
          replaced = true;
        }
        const snapshot = this.read(mutation.modelId);
        if (snapshot.revision === null || !snapshot.keyConfigured) throw new Error("CREDENTIAL_STORAGE_UNSAFE");
        atomicWritePrivateFile(metadataPath, `${JSON.stringify({ schemaVersion: "model-credential-metadata-v1", revision: snapshot.revision,
          keyUpdatedAt: replaced ? now : snapshot.keyUpdatedAt, lastOperationId: operationId, validation })}\n`, oldMetadata?.identity ?? null, 4096);
        return this.read(mutation.modelId);
      } catch (error) {
        if (replaced || (error instanceof PrivateFileCommitError && error.committed)) throw new PrivateFileCommitError(true);
        throw error;
      }
    });
  }
}

export class ModelCredentialRoutes {
  private readonly inFlight = new Set<RefineModelId>();
  private readonly store: ModelCredentialStore;
  constructor(privateDir: string, private readonly security: ReviewAdminSecurity, private readonly probe: ModelProviderProbe = probeModelProvider, private readonly now: () => number = Date.now, private readonly allowModelNetwork: () => boolean = () => false) {
    this.store = new ModelCredentialStore(privateDir, security);
  }
  private networkAllowed(): boolean { try { return this.allowModelNetwork() === true; } catch { return false; } }
  read(context: RawAdminContext) { this.security.authorizeRead(context); return this.store.snapshot(); }
  async mutate(context: RawAdminContext, value: unknown) {
    const prepared = prepareModelCredentialMutation(value);
    const { mutation, binding } = prepared;
    if (context.path !== MODEL_CREDENTIALS_PATH || singleRawHeader(context, "idempotency-key") !== mutation.idempotencyKey) throw new ReviewRealError("ADMIN_REQUEST_INVALID", 400);
    this.security.authorizeMutation(context, binding);
    const validationTarget = mutation.action === "test" && mutation.apiKey !== undefined ? "input" as const : "saved" as const;
    const response = (status: number, reasonCode: string | null, validation: CredentialValidation, credential = this.store.read(mutation.modelId)) => ({ status,
      body: { schemaVersion: MODEL_CREDENTIALS_SCHEMA, status: reasonCode === null ? "succeeded" : "failed", action: mutation.action,
        modelId: mutation.modelId, operationId: binding.operationId, validationTarget, validation, credential, ...(reasonCode === null ? {} : { reasonCode }) } });
    if (this.inFlight.has(mutation.modelId)) return response(409, "CREDENTIAL_BUSY", UNVERIFIED);
    this.inFlight.add(mutation.modelId);
    try {
      let original: PrivateFile | null;
      try { original = this.store.readKey(mutation.modelId); } catch { return response(409, "CREDENTIAL_STORAGE_UNSAFE", UNVERIFIED); }
      if (this.store.revision(mutation.modelId, original) !== mutation.expectedRevision) return response(409, "CREDENTIAL_REVISION_CONFLICT", UNVERIFIED);
      const key = mutation.apiKey?.trim() ?? original?.text.trim();
      if (key === undefined || !refineModelById(mutation.modelId).apiKeyPattern.test(key)) return response(400, key === undefined ? "CREDENTIAL_KEY_MISSING" : "CREDENTIAL_FORMAT_INVALID", UNVERIFIED);
      if (mutation.action === "replaceKey" || validationTarget === "saved") {
        try { this.store.assertWriteReady(mutation.modelId); }
        catch (error) { return response(409, error instanceof Error && error.message === "CREDENTIAL_BUSY" ? "CREDENTIAL_BUSY" : "CREDENTIAL_SAVE_FAILED", UNVERIFIED); }
      }
      if (!this.networkAllowed()) return response(503, "CREDENTIAL_NETWORK_DISABLED", UNVERIFIED);
      const result = await this.probe(mutation.modelId, key);
      // No await is allowed from reauthorization to commit: session/fresh/backup and file CAS form one boundary.
      const authorization = this.security.authorizeMutation(context, binding);
      if (!this.networkAllowed()) { this.security.commitMutation(authorization); return response(503, "CREDENTIAL_NETWORK_DISABLED", UNVERIFIED); }
      const current = this.store.readKey(mutation.modelId);
      if ((current?.identity ?? null) !== (original?.identity ?? null) || this.store.revision(mutation.modelId, current) !== mutation.expectedRevision) {
        this.security.commitMutation(authorization); return response(409, "CREDENTIAL_REVISION_CONFLICT", UNVERIFIED);
      }
      const checkedAt = new Date(this.now()).toISOString();
      const validation: CredentialValidation = { ...result, checkedAt };
      let credential = this.store.read(mutation.modelId);
      if ((mutation.action === "replaceKey" && result.status === "verified") || (mutation.action === "test" && validationTarget === "saved")) {
        try { credential = this.store.commit({ mutation, operationId: binding.operationId, original, validation, now: checkedAt }); }
        catch (error) {
          this.security.commitMutation(authorization);
          const reason = error instanceof PrivateFileCommitError ? error.message : error instanceof Error && ["CREDENTIAL_BUSY", "CREDENTIAL_REVISION_CONFLICT"].includes(error.message) ? error.message : "CREDENTIAL_SAVE_FAILED";
          return response(error instanceof PrivateFileCommitError && error.committed ? 503 : 409, reason, validation);
        }
      }
      this.security.commitMutation(authorization);
      return response(result.status === "verified" ? 200 : 422, result.reasonCode, validation, credential);
    } finally { this.inFlight.delete(mutation.modelId); }
  }
}
