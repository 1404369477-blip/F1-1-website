import { createHash } from "node:crypto";
import { z } from "zod";

import { PAGES_URL } from "./config.ts";
import type { SiteBundle } from "./site-bundle.ts";

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const CONFIRM_INTERVAL_MS = 5 * 60 * 1000;
const DEPLOY_RETRY_MS = 30 * 60 * 1000;
const MAX_PUSH_ATTEMPTS = 3;

type Sample = { key: string; path: string; sha256: string; kind: "feed" | "detail"; publicId?: string };
export type PublicationArtifacts = {
  uiManifestSha256: string;
  workflowSha256: string;
  storyTemplateSha256: string | null;
  story: { path: string; sha256: string } | null;
};
export type PublicationTarget = { bundleId: string; indexPath: string; indexSha256: string; samples: Sample[]; artifacts?: PublicationArtifacts };
export type ConfirmedPublication = { fingerprint: string; bundleId: string; commit: string; confirmedAt: string; publicIds: string[] };
export type PendingPublication = {
  target: PublicationTarget;
  fingerprint: string;
  publicIds: string[];
  itemCount: number;
  commit: string | null;
  pushAttempts: number;
  lastPushAt: string;
  nextCheckAt: string;
  lastError: string | null;
};
export type PublicationState = {
  schemaVersion: "lean-publication-state-v2";
  confirmed: ConfirmedPublication | null;
  pending: PendingPublication | null;
  // Retained for existing read-only status consumers. These now mean verified online.
  lastPublishedFingerprint: string | null;
  lastPublishedAt: string | null;
  lastCommit: string | null;
};

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const publicId = z.string().regex(/^public-[a-z0-9-]{1,120}$/);
const timestamp = z.string().datetime();
const fingerprint = z.string().min(1).max(1024);
const commit = z.string().min(1).max(64);
const targetSchema = z.object({
  bundleId: hash, indexSha256: hash, indexPath: z.string(),
  artifacts: z.object({ uiManifestSha256: hash, workflowSha256: hash, storyTemplateSha256: hash.nullable(),
    story: z.object({ path: z.string().regex(/^stories\/public-[a-z0-9-]{1,120}\/$/), sha256: hash }).strict().nullable() }).strict().optional(),
  samples: z.array(z.object({ key: z.string(), path: z.string(), sha256: hash, kind: z.enum(["feed", "detail"]), publicId: publicId.optional() }).strict()).min(1).max(2)
}).strict().refine((target) => target.indexSha256 === target.bundleId && target.indexPath === `_public/generations/${target.bundleId}/index.json`
  && target.samples.filter((sample) => sample.kind === "feed").length === 1
  && target.samples.every((sample) => sample.path === `responses/${sample.sha256}.json`
    && (sample.kind === "feed" ? sample.key === "/api/public/feed" && sample.publicId === undefined : sample.key === `/api/public/stories/${sample.publicId}`)));
const stateSchema = z.object({
  schemaVersion: z.literal("lean-publication-state-v2"),
  confirmed: z.object({ fingerprint, bundleId: hash, commit, confirmedAt: timestamp, publicIds: z.array(publicId) }).strict().nullable(),
  pending: z.object({ target: targetSchema, fingerprint, publicIds: z.array(publicId), itemCount: z.number().int().nonnegative(),
    commit: commit.nullable(), pushAttempts: z.number().int().min(0).max(MAX_PUSH_ATTEMPTS), lastPushAt: timestamp, nextCheckAt: timestamp, lastError: z.string().nullable() }).strict().nullable(),
  lastPublishedFingerprint: fingerprint.nullable(), lastPublishedAt: timestamp.nullable(), lastCommit: commit.nullable()
}).strict().refine((state) => state.lastPublishedFingerprint === (state.confirmed?.fingerprint ?? null)
  && state.lastPublishedAt === (state.confirmed?.confirmedAt ?? null) && state.lastCommit === (state.confirmed?.commit ?? null));

/** Legacy push receipts cannot establish online publication. A v2 cycle verifies a fresh generation. */
export function publicationState(raw: unknown): PublicationState {
  if (raw && typeof raw === "object" && "schemaVersion" in raw) {
    const parsed = stateSchema.safeParse(raw);
    if (!parsed.success) throw new Error("PUBLISH_STATE_INVALID");
    return parsed.data;
  }
  return { schemaVersion: "lean-publication-state-v2", confirmed: null, pending: null, lastPublishedFingerprint: null, lastPublishedAt: null, lastCommit: null };
}

/** Persist only public response identities, never model credentials or private settings. */
export function publicationTarget(bundle: SiteBundle, artifacts?: PublicationArtifacts): PublicationTarget {
  const indexPath = `_public/generations/${bundle.bundleId}/index.json`;
  const indexBytes = bundle.files.get(indexPath);
  if (!indexBytes || sha256(indexBytes) !== bundle.bundleId) throw new Error("PUBLISH_INDEX_INVALID");
  const index = JSON.parse(indexBytes.toString("utf8")) as { responses: Record<string, { path: string; sha256: string; status: number }> };
  const samples: Sample[] = [];
  const feed = Object.entries(index.responses).find(([key, ref]) => key === "/api/public/feed" && ref.status === 200);
  if (!feed) throw new Error("PUBLISH_FEED_MISSING");
  samples.push({ key: feed[0], path: feed[1].path, sha256: feed[1].sha256, kind: "feed" });
  const detail = Object.entries(index.responses).find(([key, ref]) => /^\/api\/public\/stories\/public-[a-z0-9-]{1,120}$/.test(key) && ref.status === 200);
  if (detail) samples.push({ key: detail[0], path: detail[1].path, sha256: detail[1].sha256, kind: "detail", publicId: detail[0].split("/").at(-1) });
  if (bundle.itemCount > 0 && !detail) throw new Error("PUBLISH_DETAIL_MISSING");
  return { bundleId: bundle.bundleId, indexPath, indexSha256: bundle.bundleId, samples, ...(artifacts ? { artifacts } : {}) };
}

/** Compare pointer, exact index bytes, and representative feed/detail response bytes on the public host. */
export async function confirmPublication(target: PublicationTarget, fetcher: typeof fetch = fetch, baseUrl = PAGES_URL): Promise<void> {
  const get = async (path: string): Promise<Buffer> => {
    const url = new URL(path, baseUrl);
    url.searchParams.set("publication", target.bundleId);
    const response = await fetcher(url, { signal: AbortSignal.timeout(15_000), redirect: "error", cache: "no-store", headers: { accept: "application/json, text/html" } });
    if (!response.ok) throw new Error(`PUBLISH_CONFIRM_HTTP_${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > 10 * 1024 * 1024) throw new Error("PUBLISH_CONFIRM_TOO_LARGE");
    return bytes;
  };
  const pointerMatches = (bytes: Buffer): boolean => {
    const pointer = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
    return pointer.schemaVersion === "public-static-pointer-v1" && pointer.bundleId === target.bundleId
      && pointer.indexPath === target.indexPath && pointer.indexSha256 === target.indexSha256;
  };
  try {
    if (!pointerMatches(await get("_public/current.json"))) throw new Error("PUBLISH_CONFIRM_POINTER_MISMATCH");
    const indexBytes = await get(target.indexPath);
    if (sha256(indexBytes) !== target.indexSha256) throw new Error("PUBLISH_CONFIRM_INDEX_HASH");
    const index = JSON.parse(indexBytes.toString("utf8")) as { responses: Record<string, { path: string; sha256: string; status: number }> };
    await Promise.all(target.samples.map(async (sample) => {
      const reference = index.responses[sample.key];
      if (!reference || reference.path !== sample.path || reference.sha256 !== sample.sha256 || reference.status !== 200
        || !/^responses\/[a-f0-9]{64}\.json$/.test(sample.path)) throw new Error("PUBLISH_CONFIRM_SAMPLE_REFERENCE");
      const bytes = await get(`_public/generations/${target.bundleId}/${sample.path}`);
      if (sha256(bytes) !== sample.sha256) throw new Error("PUBLISH_CONFIRM_SAMPLE_HASH");
      const body = JSON.parse(bytes.toString("utf8")) as { schemaVersion?: string; items?: unknown[]; story?: { publicId?: string } };
      if (body.schemaVersion !== "public-read-v0.1" || (sample.kind === "feed" ? !Array.isArray(body.items) : body.story?.publicId !== sample.publicId)) throw new Error("PUBLISH_CONFIRM_SAMPLE_BODY");
    }));
    if (target.artifacts) {
      const expected = target.artifacts;
      const deployment = JSON.parse((await get("_deployment.json")).toString("utf8")) as Record<string, unknown>;
      if (deployment.schemaVersion !== "public-static-deployment-v1" || deployment.bundleId !== target.bundleId
        || deployment.uiManifestSha256 !== expected.uiManifestSha256 || deployment.workflowSha256 !== expected.workflowSha256
        || deployment.storyTemplateSha256 !== expected.storyTemplateSha256) throw new Error("PUBLISH_CONFIRM_DEPLOYMENT_IDENTITY");
      if (expected.story && sha256(await get(expected.story.path)) !== expected.story.sha256) throw new Error("PUBLISH_CONFIRM_STORY_HTML_HASH");
    }
    // A deployment switching during the read must be checked again in the next cycle.
    if (!pointerMatches(await get("_public/current.json"))) throw new Error("PUBLISH_CONFIRM_POINTER_CHANGED");
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    throw new Error(/^PUBLISH_CONFIRM_[A-Z0-9_]+$/.test(code) ? code : "PUBLISH_CONFIRM_UNAVAILABLE");
  }
}

type PublicationDependencies = {
  save: (state: PublicationState) => void;
  confirm: (target: PublicationTarget) => Promise<void>;
  push: (beforePush: (commit: string) => void) => string;
  retry: (pending: PendingPublication, beforePush: (commit: string) => void) => string;
  clock?: () => Date;
};

export type PublicationResult = { items: number; published: boolean; commit: string | null; reason: string };

/** One cycle does at most one push; unconfirmed receipts survive restarts and are checked without repushing. */
export async function advancePublication(state: PublicationState, input: {
  bundle: SiteBundle; fingerprint: string; publicIds: readonly string[]; now: Date; allowPush: boolean; artifacts?: PublicationArtifacts;
}, dependencies: PublicationDependencies): Promise<PublicationResult> {
  const { bundle } = input;
  const clock = dependencies.clock ?? (() => input.now);
  const now = clock();
  const at = now.toISOString();
  let confirmedNow = false;
  if (state.pending && Date.parse(state.pending.nextCheckAt) <= now.getTime()) {
    const pending = state.pending;
    try {
      await dependencies.confirm(pending.target);
      if (!pending.commit) throw new Error("PUBLISH_CONFIRM_COMMIT_MISSING");
      const confirmedAt = clock().toISOString();
      state.confirmed = { fingerprint: pending.fingerprint, bundleId: pending.target.bundleId, commit: pending.commit, confirmedAt, publicIds: [...pending.publicIds] };
      state.lastPublishedFingerprint = pending.fingerprint;
      state.lastPublishedAt = confirmedAt;
      state.lastCommit = pending.commit;
      state.pending = null;
      confirmedNow = true;
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      pending.lastError = /^PUBLISH_[A-Z0-9_]+$/.test(code) ? code : "PUBLISH_CONFIRM_UNAVAILABLE";
      pending.nextCheckAt = new Date(now.getTime() + CONFIRM_INTERVAL_MS).toISOString();
    }
    dependencies.save(state);
  }
  const result = (reason: string): PublicationResult => ({ items: bundle.itemCount, published: confirmedNow && state.confirmed?.fingerprint === input.fingerprint, commit: state.pending?.commit ?? state.confirmed?.commit ?? null, reason });
  if (!input.allowPush) return result(state.pending ? "AWAITING_CONFIRMATION" : "PUBLISH_DISABLED");
  if (!state.pending && state.confirmed?.fingerprint === input.fingerprint) return result(confirmedNow ? "PUBLISHED" : "UNCHANGED");

  let retryExisting = false;
  if (state.pending) {
    if (now.getTime() - Date.parse(state.pending.lastPushAt) < DEPLOY_RETRY_MS) return result("AWAITING_CONFIRMATION");
    if (state.pending.fingerprint === input.fingerprint) {
      if (state.pending.pushAttempts >= MAX_PUSH_ATTEMPTS) return result("CONFIRMATION_RETRY_EXHAUSTED");
      // Staging may have failed before a commit was prepared. Rebuild from the supplied bundle in that case.
      retryExisting = state.pending.commit !== null;
    }
  }
  if (!retryExisting) {
    const attempts = state.pending?.fingerprint === input.fingerprint ? state.pending.pushAttempts : 0;
    state.pending = { target: publicationTarget(bundle, input.artifacts), fingerprint: input.fingerprint, publicIds: [...input.publicIds], itemCount: bundle.itemCount,
      commit: null, pushAttempts: attempts, lastPushAt: at, nextCheckAt: at, lastError: null };
  }
  const pending = state.pending!;
  pending.pushAttempts++;
  pending.lastPushAt = at;
  pending.nextCheckAt = new Date(now.getTime() + CONFIRM_INTERVAL_MS).toISOString();
  dependencies.save(state);
  const beforePush = (commit: string): void => {
    pending.commit = commit;
    pending.lastPushAt = clock().toISOString();
    pending.nextCheckAt = new Date(clock().getTime() + CONFIRM_INTERVAL_MS).toISOString();
    dependencies.save(state); // Crash/unknown push recovery is tied to this exact candidate before network mutation.
  };
  try {
    const commit = retryExisting ? dependencies.retry(pending, beforePush) : dependencies.push(beforePush);
    pending.commit = commit;
    pending.lastError = null;
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    pending.lastError = /^(?:GIT|PUBLISH)_[A-Z0-9_]+$/.test(code) ? code : "PUBLISH_PUSH_FAILED";
    if (!pending.commit) pending.lastPushAt = clock().toISOString();
  }
  dependencies.save(state);
  return result(pending.lastError ? "PUBLISH_UNCONFIRMED" : "AWAITING_CONFIRMATION");
}
