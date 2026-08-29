import { createHash } from "node:crypto";
import { closeSync, constants as fsConstants, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import {
  ADMIN_RELEASE_RUNTIME_FILE_COUNT,
  ADMIN_RELEASE_RUNTIME_FILES,
  ADMIN_RELEASE_RUNTIME_PATH_SET_SHA256
} from "../admin-service/release-manifest.ts";
import {
  PUBLIC_RELEASE_RUNTIME_FILE_COUNT,
  PUBLIC_RELEASE_RUNTIME_FILES,
  PUBLIC_RELEASE_RUNTIME_PATH_SET_SHA256
} from "../public/release-manifest.ts";
import {
  assertSourceRegistrySchema,
  SOURCE_REGISTRY_MIGRATION_SHA256,
  SOURCE_REGISTRY_SCHEMA10_SHA256,
  SOURCE_REGISTRY_SOURCE_0009_RAW_SHA256
} from "../rss/source-registry-migration.ts";
import { canonicalJsonV1 } from "./gateway.ts";

const HASH = /^[0-9a-f]{64}$/;
const GIT_HASH = /^[0-9a-f]{40}$/;
function fail(code: string): never { throw new Error(code); }
function assert(condition: unknown, code: string): asserts condition { if (!condition) fail(code); }
function hash(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function validateHash(value: string, code: string): void { assert(HASH.test(value), code); }
function assertExactKeys(value: object, expected: readonly string[], code: string): void {
  assert(canonicalJsonV1(Object.keys(value).sort()) === canonicalJsonV1([...expected].sort()), code);
}
function inside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

export const RELEASE_SCHEMA_VERSION = 10 as const;
export type ReleaseRole = "full_v10" | "manual_only_fallback_v10";
export type CapabilitySet = Readonly<{
  read: true;
  freshPauseStop: true;
  manualSafetyReviewPublishWithdraw: true;
  manualOutboxCreate: true;
  publicLkg: true;
  sameDeliverySender: true;
  automaticReview: false;
  automaticPublish: false;
  collectorNetwork: boolean;
  modelNetwork: boolean;
  retryModelCalls: boolean;
  systemSnapshot: boolean;
  phaseEnter: boolean;
  phaseResume: boolean;
}>;

export type ReleaseFileRecord = Readonly<{
  path: string;
  sha256: string;
  bytes: number;
}>;

export type ReleaseCandidateManifest = Readonly<{
  schemaVersion: 10;
  role: ReleaseRole;
  releaseId: string;
  sourceCommitSha1: string;
  sourceTreeSha1: string;
  sourcePreimageSha256: string;
  schemaSha256: string;
  migration0009RawSha256: string;
  migration0010RawSha256: string;
  adminRuntimeFileCount: 153;
  adminRuntimePathSetSha256: string;
  publicRuntimeFileCount: 89;
  publicRuntimePathSetSha256: string;
  packageLockSha256: string;
  packageRootSha256: string;
  pathRootSha256: string;
  files: readonly ReleaseFileRecord[];
  capabilities: CapabilitySet;
}>;

export type ReleasePairReceipt = Readonly<{
  schemaVersion: "f1plus1-release-pair-v10";
  pairId: string;
  fullReleaseId: string;
  fallbackReleaseId: string;
  sourceCommitSha1: string;
  sourceTreeSha1: string;
  sourcePreimageSha256: string;
  schemaSha256: string;
  packageRootSha256: string;
  fullPathRootSha256: string;
  fallbackPathRootSha256: string;
  fullManifestSha256: string;
  fallbackManifestSha256: string;
  generatedAt: string;
  nextPairId: null;
}>;

export type ReleaseRuntimeAction =
  | "read"
  | "fresh_pause_stop"
  | "manual_safety_review_publish_withdraw"
  | "manual_outbox_create"
  | "public_lkg"
  | "delivery_sender"
  | "collector_network"
  | "model_network"
  | "retry_model_call"
  | "system_snapshot"
  | "phase_enter"
  | "phase_resume"
  | "automatic_review"
  | "automatic_publish";

export type ReleaseActivationReceipt = Readonly<{
  schemaVersion: "f1plus1-release-activation-v10";
  activationId: string;
  pairId: string;
  releaseId: string;
  role: ReleaseRole;
  manifestSha256: string;
  sourcePreimageSha256: string;
  schemaSha256: string;
  capabilitiesSha256: string;
  activatedAt: string;
  previousActivationId: string | null;
}>;

export type ReleaseRuntimeGate = Readonly<{
  receipt: ReleaseActivationReceipt;
  capabilities: CapabilitySet;
  allows(action: ReleaseRuntimeAction): boolean;
  run<T>(action: ReleaseRuntimeAction, callback: () => T): T;
}>;

const sharedIdentityFields = [
  "sourceCommitSha1",
  "sourceTreeSha1",
  "sourcePreimageSha256",
  "schemaSha256",
  "migration0009RawSha256",
  "migration0010RawSha256",
  "adminRuntimeFileCount",
  "adminRuntimePathSetSha256",
  "publicRuntimeFileCount",
  "publicRuntimePathSetSha256",
  "packageLockSha256",
  "packageRootSha256"
] as const;
const RELEASE_RUNTIME_FILES = Object.freeze([...new Set([
  ...ADMIN_RELEASE_RUNTIME_FILES,
  ...PUBLIC_RELEASE_RUNTIME_FILES
])].sort());

export function releasePathRoot(files: readonly ReleaseFileRecord[]): string {
  return hash(`f1plus1-release-path-root-v10\n${canonicalJsonV1(files)}`);
}

export function releaseSourcePreimageSha256(input: Readonly<{
  sourceCommitSha1: string;
  sourceTreeSha1: string;
  schemaSha256: string;
  packageRootSha256: string;
  pathRootSha256: string;
}>): string {
  return hash(`f1plus1-release-source-preimage-v10\n${canonicalJsonV1({
    sourceCommitSha1: input.sourceCommitSha1,
    sourceTreeSha1: input.sourceTreeSha1,
    schemaSha256: input.schemaSha256,
    packageRootSha256: input.packageRootSha256,
    pathRootSha256: input.pathRootSha256
  })}`);
}

export function releaseIdForRole(role: ReleaseRole, sourcePreimageSha256: string): string {
  validateHash(sourcePreimageSha256, "RELEASE_SOURCE_PREIMAGE_INVALID");
  return `${role}-${sourcePreimageSha256.slice(0, 16)}`;
}

function assertFiles(manifest: ReleaseCandidateManifest): void {
  const paths = new Set<string>();
  let previous = "";
  for (const file of manifest.files) {
    assert(file !== null && typeof file === "object", "RELEASE_FILE_RECORD_INVALID");
    assertExactKeys(file, ["path", "sha256", "bytes"], "RELEASE_FILE_RECORD_INVALID");
    assert(
      file.path.length > 0 && !isAbsolute(file.path) && !file.path.startsWith("../") &&
      file.path > previous && !paths.has(file.path),
      "RELEASE_PATH_SET_INVALID"
    );
    validateHash(file.sha256, "RELEASE_FILE_HASH_INVALID");
    assert(Number.isSafeInteger(file.bytes) && file.bytes >= 0, "RELEASE_FILE_SIZE_INVALID");
    paths.add(file.path);
    previous = file.path;
  }
  assert(
    canonicalJsonV1(manifest.files.map((file) => file.path)) === canonicalJsonV1(RELEASE_RUNTIME_FILES),
    "RELEASE_RUNTIME_PATHS_INCOMPLETE"
  );
  assert(releasePathRoot(manifest.files) === manifest.pathRootSha256, "RELEASE_PATH_ROOT_INVALID");
}

export function assertReleaseCandidate(manifest: ReleaseCandidateManifest): void {
  assert(manifest !== null && typeof manifest === "object", "RELEASE_MANIFEST_INVALID");
  assertExactKeys(manifest, [
    "schemaVersion", "role", "releaseId", "sourceCommitSha1", "sourceTreeSha1", "sourcePreimageSha256",
    "schemaSha256", "migration0009RawSha256", "migration0010RawSha256", "adminRuntimeFileCount",
    "adminRuntimePathSetSha256", "publicRuntimeFileCount", "publicRuntimePathSetSha256", "packageLockSha256",
    "packageRootSha256", "pathRootSha256", "files", "capabilities"
  ], "RELEASE_MANIFEST_INVALID");
  assert(manifest.role === "full_v10" || manifest.role === "manual_only_fallback_v10", "RELEASE_ROLE_INVALID");
  assert(manifest.capabilities !== null && typeof manifest.capabilities === "object", "RELEASE_CAPABILITIES_INVALID");
  assertExactKeys(manifest.capabilities, [
    "read", "freshPauseStop", "manualSafetyReviewPublishWithdraw", "manualOutboxCreate", "publicLkg",
    "sameDeliverySender", "automaticReview", "automaticPublish", "collectorNetwork", "modelNetwork",
    "retryModelCalls", "systemSnapshot", "phaseEnter", "phaseResume"
  ], "RELEASE_CAPABILITIES_INVALID");
  assert(manifest.schemaVersion === RELEASE_SCHEMA_VERSION, "RELEASE_SCHEMA_VERSION_INVALID");
  assert(manifest.releaseId === releaseIdForRole(manifest.role, manifest.sourcePreimageSha256), "RELEASE_ID_INVALID");
  assert(GIT_HASH.test(manifest.sourceCommitSha1) && GIT_HASH.test(manifest.sourceTreeSha1), "RELEASE_GIT_IDENTITY_INVALID");
  for (const field of [
    "sourcePreimageSha256", "schemaSha256", "migration0009RawSha256", "migration0010RawSha256",
    "adminRuntimePathSetSha256", "publicRuntimePathSetSha256", "packageLockSha256",
    "packageRootSha256", "pathRootSha256"
  ] as const) validateHash(manifest[field], `RELEASE_${field.toUpperCase()}_INVALID`);
  assert(
    manifest.schemaSha256 === SOURCE_REGISTRY_SCHEMA10_SHA256 &&
    manifest.migration0009RawSha256 === SOURCE_REGISTRY_SOURCE_0009_RAW_SHA256 &&
    manifest.migration0010RawSha256 === SOURCE_REGISTRY_MIGRATION_SHA256,
    "RELEASE_SCHEMA_IDENTITY_MISMATCH"
  );
  assert(
    manifest.adminRuntimeFileCount === ADMIN_RELEASE_RUNTIME_FILE_COUNT &&
    manifest.adminRuntimePathSetSha256 === ADMIN_RELEASE_RUNTIME_PATH_SET_SHA256 &&
    manifest.publicRuntimeFileCount === PUBLIC_RELEASE_RUNTIME_FILE_COUNT &&
    manifest.publicRuntimePathSetSha256 === PUBLIC_RELEASE_RUNTIME_PATH_SET_SHA256,
    "RELEASE_RUNTIME_CLOSURE_MISMATCH"
  );
  assertFiles(manifest);
  assert(
    manifest.sourcePreimageSha256 === releaseSourcePreimageSha256(manifest),
    "RELEASE_SOURCE_PREIMAGE_MISMATCH"
  );
  const packageLock = manifest.files.find((file) => file.path === "package-lock.json");
  assert(packageLock?.sha256 === manifest.packageLockSha256, "RELEASE_PACKAGE_LOCK_MISMATCH");
}

export function hashReleaseManifest(manifest: ReleaseCandidateManifest): string {
  assertReleaseCandidate(manifest);
  return hash(`f1plus1-release-manifest-v10\n${canonicalJsonV1(manifest)}`);
}

export function collectReleaseFiles(sourceRoot: string, paths: readonly string[]): readonly ReleaseFileRecord[] {
  const root = realpathSync(resolve(sourceRoot));
  const seen = new Set<string>();
  const files = [...paths].sort().map((path) => {
    assert(typeof path === "string" && path.length > 0 && !isAbsolute(path), "RELEASE_PATH_INVALID");
    const absolute = resolve(root, path);
    assert(inside(root, absolute), "RELEASE_PATH_ESCAPE");
    const canonical = realpathSync(absolute);
    assert(inside(root, canonical), "RELEASE_SYMLINK_ESCAPE");
    assert(!seen.has(canonical), "RELEASE_PATH_DUPLICATE");
    seen.add(canonical);
    const stat = lstatSync(absolute);
    assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, "RELEASE_FILE_NOT_PRIVATE");
    return Object.freeze({ path, sha256: hash(readFileSync(absolute)), bytes: stat.size });
  });
  return Object.freeze(files);
}

export function fullV10Capabilities(): CapabilitySet {
  return Object.freeze({
    read: true,
    freshPauseStop: true,
    manualSafetyReviewPublishWithdraw: true,
    manualOutboxCreate: true,
    publicLkg: true,
    sameDeliverySender: true,
    automaticReview: false,
    automaticPublish: false,
    collectorNetwork: true,
    modelNetwork: true,
    retryModelCalls: true,
    systemSnapshot: true,
    phaseEnter: true,
    phaseResume: true
  });
}

export function fallbackV10Capabilities(): CapabilitySet {
  return Object.freeze({
    read: true,
    freshPauseStop: true,
    manualSafetyReviewPublishWithdraw: true,
    manualOutboxCreate: true,
    publicLkg: true,
    sameDeliverySender: true,
    automaticReview: false,
    automaticPublish: false,
    collectorNetwork: false,
    modelNetwork: false,
    retryModelCalls: false,
    systemSnapshot: false,
    phaseEnter: false,
    phaseResume: false
  });
}

export function assertFallbackCapabilities(manifest: ReleaseCandidateManifest): void {
  assertReleaseCandidate(manifest);
  assert(manifest.role === "manual_only_fallback_v10", "FALLBACK_ROLE_INVALID");
  for (const field of [
    "read", "freshPauseStop", "manualSafetyReviewPublishWithdraw",
    "manualOutboxCreate", "publicLkg", "sameDeliverySender"
  ] as const) assert(manifest.capabilities[field] === true, `FALLBACK_CAPABILITY_${field.toUpperCase()}_CLOSED`);
  for (const field of [
    "automaticReview", "automaticPublish", "collectorNetwork", "modelNetwork",
    "retryModelCalls", "systemSnapshot", "phaseEnter", "phaseResume"
  ] as const) assert(manifest.capabilities[field] === false, `FALLBACK_CAPABILITY_${field.toUpperCase()}_OPEN`);
}

export function assertFullCapabilities(manifest: ReleaseCandidateManifest): void {
  assertReleaseCandidate(manifest);
  assert(manifest.role === "full_v10", "FULL_ROLE_INVALID");
  assert(manifest.capabilities.automaticReview === false && manifest.capabilities.automaticPublish === false, "FULL_AUTOMATION_REGISTRATION_OPEN");
  for (const field of [
    "read", "freshPauseStop", "manualSafetyReviewPublishWithdraw", "manualOutboxCreate",
    "publicLkg", "sameDeliverySender", "collectorNetwork", "modelNetwork",
    "retryModelCalls", "systemSnapshot", "phaseEnter", "phaseResume"
  ] as const) assert(manifest.capabilities[field] === true, `FULL_CAPABILITY_${field.toUpperCase()}_CLOSED`);
}

export function assertReleasePair(
  full: ReleaseCandidateManifest,
  fallback: ReleaseCandidateManifest,
  receipt: ReleasePairReceipt
): void {
  assertFullCapabilities(full);
  assertFallbackCapabilities(fallback);
  for (const field of sharedIdentityFields) {
    assert(full[field] === fallback[field], "RELEASE_PAIR_IDENTITY_MISMATCH");
  }
  assert(
    full.files.length === fallback.files.length &&
    full.pathRootSha256 === fallback.pathRootSha256 &&
    canonicalJsonV1(full.files) === canonicalJsonV1(fallback.files),
    "RELEASE_PAIR_PATH_MISMATCH"
  );
  assert(receipt.schemaVersion === "f1plus1-release-pair-v10", "RELEASE_PAIR_SCHEMA_INVALID");
  assertExactKeys(receipt, [
    "schemaVersion", "pairId", "fullReleaseId", "fallbackReleaseId", "sourceCommitSha1", "sourceTreeSha1",
    "sourcePreimageSha256", "schemaSha256", "packageRootSha256", "fullPathRootSha256", "fallbackPathRootSha256",
    "fullManifestSha256", "fallbackManifestSha256", "generatedAt", "nextPairId"
  ], "RELEASE_PAIR_INVALID");
  assert(receipt.fullReleaseId === full.releaseId && receipt.fallbackReleaseId === fallback.releaseId, "RELEASE_PAIR_ID_MISMATCH");
  assert(
    receipt.sourceCommitSha1 === full.sourceCommitSha1 &&
    receipt.sourceTreeSha1 === full.sourceTreeSha1 &&
    receipt.sourcePreimageSha256 === full.sourcePreimageSha256 &&
    receipt.schemaSha256 === full.schemaSha256 &&
    receipt.packageRootSha256 === full.packageRootSha256 &&
    receipt.fullPathRootSha256 === full.pathRootSha256 &&
    receipt.fallbackPathRootSha256 === fallback.pathRootSha256,
    "RELEASE_PAIR_RECEIPT_MISMATCH"
  );
  assert(
    receipt.fullManifestSha256 === hashReleaseManifest(full) &&
    receipt.fallbackManifestSha256 === hashReleaseManifest(fallback),
    "RELEASE_PAIR_MANIFEST_MISMATCH"
  );
  assert(receipt.nextPairId === null, "RELEASE_PAIR_CYCLE");
  assert(Number.isFinite(Date.parse(receipt.generatedAt)), "RELEASE_PAIR_TIME_INVALID");
  const { pairId: _pairId, ...core } = receipt;
  assert(pairIdForCore(core) === receipt.pairId, "RELEASE_PAIR_HASH_INVALID");
}

function pairIdForCore(core: Omit<ReleasePairReceipt, "pairId">): string {
  return hash(`f1plus1-release-pair-v10\n${canonicalJsonV1(core)}`);
}

export function buildReleasePairReceipt(
  full: ReleaseCandidateManifest,
  fallback: ReleaseCandidateManifest,
  generatedAt: string
): ReleasePairReceipt {
  assertFullCapabilities(full);
  assertFallbackCapabilities(fallback);
  for (const field of sharedIdentityFields) assert(full[field] === fallback[field], "RELEASE_PAIR_IDENTITY_MISMATCH");
  assert(full.pathRootSha256 === fallback.pathRootSha256, "RELEASE_PAIR_PATH_MISMATCH");
  const fullManifestSha256 = hashReleaseManifest(full);
  const fallbackManifestSha256 = hashReleaseManifest(fallback);
  const core = Object.freeze({
    schemaVersion: "f1plus1-release-pair-v10" as const,
    fullReleaseId: full.releaseId,
    fallbackReleaseId: fallback.releaseId,
    sourceCommitSha1: full.sourceCommitSha1,
    sourceTreeSha1: full.sourceTreeSha1,
    sourcePreimageSha256: full.sourcePreimageSha256,
    schemaSha256: full.schemaSha256,
    packageRootSha256: full.packageRootSha256,
    fullPathRootSha256: full.pathRootSha256,
    fallbackPathRootSha256: fallback.pathRootSha256,
    fullManifestSha256,
    fallbackManifestSha256,
    generatedAt,
    nextPairId: null
  });
  const pairId = pairIdForCore(core);
  const receipt = Object.freeze({ ...core, pairId });
  assertReleasePair(full, fallback, receipt);
  return receipt;
}

const ACTION_CAPABILITY = Object.freeze({
  read: "read",
  fresh_pause_stop: "freshPauseStop",
  manual_safety_review_publish_withdraw: "manualSafetyReviewPublishWithdraw",
  manual_outbox_create: "manualOutboxCreate",
  public_lkg: "publicLkg",
  delivery_sender: "sameDeliverySender",
  collector_network: "collectorNetwork",
  model_network: "modelNetwork",
  retry_model_call: "retryModelCalls",
  system_snapshot: "systemSnapshot",
  phase_enter: "phaseEnter",
  phase_resume: "phaseResume",
  automatic_review: "automaticReview",
  automatic_publish: "automaticPublish"
} as const satisfies Readonly<Record<ReleaseRuntimeAction, keyof CapabilitySet>>);

export function activateReleaseCandidate(
  manifest: ReleaseCandidateManifest,
  pair: ReleasePairReceipt,
  activatedAt: string,
  previousActivationId: string | null
): ReleaseRuntimeGate {
  assertReleaseCandidate(manifest);
  assert(pair.schemaVersion === "f1plus1-release-pair-v10", "RELEASE_PAIR_SCHEMA_INVALID");
  const expectedReleaseId = manifest.role === "full_v10" ? pair.fullReleaseId : pair.fallbackReleaseId;
  const expectedManifestSha256 = manifest.role === "full_v10" ? pair.fullManifestSha256 : pair.fallbackManifestSha256;
  assert(
    manifest.releaseId === expectedReleaseId &&
    hashReleaseManifest(manifest) === expectedManifestSha256 &&
    manifest.sourceCommitSha1 === pair.sourceCommitSha1 &&
    manifest.sourceTreeSha1 === pair.sourceTreeSha1 &&
    manifest.sourcePreimageSha256 === pair.sourcePreimageSha256 &&
    manifest.schemaSha256 === pair.schemaSha256 &&
    manifest.packageRootSha256 === pair.packageRootSha256 &&
    (manifest.role === "full_v10" ? manifest.pathRootSha256 === pair.fullPathRootSha256 : manifest.pathRootSha256 === pair.fallbackPathRootSha256),
    "RELEASE_ACTIVATION_PAIR_BINDING_INVALID"
  );
  assert(Number.isFinite(Date.parse(activatedAt)), "RELEASE_ACTIVATION_TIME_INVALID");
  if (previousActivationId !== null) validateHash(previousActivationId, "RELEASE_PREVIOUS_ACTIVATION_INVALID");
  const capabilitiesSha256 = hash(`f1plus1-release-capabilities-v10\n${canonicalJsonV1(manifest.capabilities)}`);
  const core = Object.freeze({
    schemaVersion: "f1plus1-release-activation-v10" as const,
    pairId: pair.pairId,
    releaseId: manifest.releaseId,
    role: manifest.role,
    manifestSha256: expectedManifestSha256,
    sourcePreimageSha256: manifest.sourcePreimageSha256,
    schemaSha256: manifest.schemaSha256,
    capabilitiesSha256,
    activatedAt,
    previousActivationId
  });
  const receipt = Object.freeze({
    ...core,
    activationId: hash(`f1plus1-release-activation-v10\n${canonicalJsonV1(core)}`)
  });
  const allows = (action: ReleaseRuntimeAction): boolean => manifest.capabilities[ACTION_CAPABILITY[action]];
  return Object.freeze({
    receipt,
    capabilities: manifest.capabilities,
    allows,
    run<T>(action: ReleaseRuntimeAction, callback: () => T): T {
      assert(allows(action), `RELEASE_RUNTIME_ACTION_CLOSED:${action}`);
      return callback();
    }
  });
}

function readCanonicalReleaseJson<T>(releaseRoot: string, path: string, expectedSha256: string, code: string): T {
  validateHash(expectedSha256, code);
  const root = realpathSync(resolve(releaseRoot));
  assert(isAbsolute(path) && resolve(path) === path, code);
  const canonicalPath = realpathSync(path);
  assert(inside(root, canonicalPath), code);
  const before = lstatSync(path);
  assert(before.isFile() && !before.isSymbolicLink() && before.nlink === 1 && (before.mode & 0o777) === 0o600 && before.uid === process.getuid?.(), code);
  const descriptor = openSync(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  let bytes: Buffer;
  try {
    const opened = fstatSync(descriptor);
    assert(opened.dev === before.dev && opened.ino === before.ino && opened.size === before.size && opened.mtimeMs === before.mtimeMs, code);
    bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    assert(after.dev === opened.dev && after.ino === opened.ino && after.size === opened.size && after.mtimeMs === opened.mtimeMs, code);
  } finally {
    closeSync(descriptor);
  }
  assert(hash(bytes) === expectedSha256, code);
  const raw = bytes.toString("utf8");
  let value: unknown;
  try { value = JSON.parse(raw) as unknown; } catch { fail(code); }
  assert(value !== null && typeof value === "object" && canonicalJsonV1(value) === raw, code);
  return value as T;
}

export function loadReleaseRuntimeGate(input: Readonly<{
  releaseRoot: string;
  fullManifestPath: string;
  fullManifestSha256: string;
  fallbackManifestPath: string;
  fallbackManifestSha256: string;
  pairReceiptPath: string;
  pairReceiptSha256: string;
  expectedSourceCommitSha1: string;
  expectedSourceTreeSha1: string;
  expectedPackageRootSha256: string;
  activeRole: ReleaseRole;
  activatedAt: string;
  previousActivationId: string | null;
}>): Readonly<{
  gate: ReleaseRuntimeGate;
  full: ReleaseCandidateManifest;
  fallback: ReleaseCandidateManifest;
  pair: ReleasePairReceipt;
}> {
  assert(GIT_HASH.test(input.expectedSourceCommitSha1) && GIT_HASH.test(input.expectedSourceTreeSha1), "RELEASE_EXPECTED_GIT_IDENTITY_INVALID");
  validateHash(input.expectedPackageRootSha256, "RELEASE_EXPECTED_PACKAGE_ROOT_INVALID");
  const full = readCanonicalReleaseJson<ReleaseCandidateManifest>(input.releaseRoot, input.fullManifestPath, input.fullManifestSha256, "RELEASE_FULL_MANIFEST_FILE_INVALID");
  const fallback = readCanonicalReleaseJson<ReleaseCandidateManifest>(input.releaseRoot, input.fallbackManifestPath, input.fallbackManifestSha256, "RELEASE_FALLBACK_MANIFEST_FILE_INVALID");
  const pair = readCanonicalReleaseJson<ReleasePairReceipt>(input.releaseRoot, input.pairReceiptPath, input.pairReceiptSha256, "RELEASE_PAIR_RECEIPT_FILE_INVALID");
  assertReleasePair(full, fallback, pair);
  assert(
    full.sourceCommitSha1 === input.expectedSourceCommitSha1 &&
    full.sourceTreeSha1 === input.expectedSourceTreeSha1 &&
    full.packageRootSha256 === input.expectedPackageRootSha256,
    "RELEASE_EXTERNAL_ANCHOR_MISMATCH"
  );
  const active = input.activeRole === "full_v10" ? full : fallback;
  const gate = activateReleaseCandidate(active, pair, input.activatedAt, input.previousActivationId);
  return Object.freeze({ gate, full, fallback, pair });
}

export type ReleaseRuntimeObservation = Readonly<{
  activationId: string;
  previousActivationId: string | null;
  pairId: string;
  releaseId: string;
  role: ReleaseRole;
  manifestSha256: string;
  schemaVersion: 10;
  schemaSha256: string;
  databaseLogicalSha256: string;
  outboxRows: number;
  idempotencyRows: number;
  externalCalls: number;
  automaticReviewRegistrations: 0;
  automaticPublishRegistrations: 0;
  publicLkgSha256: string;
}>;

export type ReleaseSwitchReceipt = Readonly<{
  schemaVersion: "f1plus1-release-switch-v10";
  pairId: string;
  fullBeforeSha256: string;
  fallbackAfterSha256: string;
  rollbackAfterSha256: string;
  fallbackTransitionSha256: string;
  rollbackTransitionSha256: string;
  databaseUnchanged: true;
  outboxUnchanged: true;
  idempotencyUnchanged: true;
  automaticReviewRegistrations: 0;
  automaticPublishRegistrations: 0;
}>;

function rowValue(value: unknown): unknown {
  if (value instanceof Uint8Array) return Buffer.from(value).toString("base64");
  if (typeof value === "bigint") return value.toString();
  return value;
}

export function releaseDatabaseLogicalSha256(database: DatabaseSync): string {
  const tables = (database.prepare(
    "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all() as Array<Record<string, unknown>>).map((row) => String(row.name));
  const snapshot = tables.map((table) => {
    const identifier = table.replaceAll('"', '""');
    const rows = (database.prepare(`SELECT * FROM "${identifier}"`).all() as Array<Record<string, unknown>>)
      .map((row) => Object.fromEntries(Object.entries(row).sort().map(([key, value]) => [key, rowValue(value)])))
      .map((row) => canonicalJsonV1(row))
      .sort();
    return Object.freeze({ table, rows });
  });
  return hash(`f1plus1-schema10-logical-db-v1\n${canonicalJsonV1(snapshot)}`);
}

function count(database: DatabaseSync, table: string): number {
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as Record<string, unknown>;
  const value = Number(row.count);
  assert(Number.isSafeInteger(value) && value >= 0, "RELEASE_DATABASE_COUNT_INVALID");
  return value;
}

export function observeReleaseRuntime(
  database: DatabaseSync,
  gate: ReleaseRuntimeGate,
  publicLkgSha256: string
): ReleaseRuntimeObservation {
  return gate.run("read", () => {
    validateHash(publicLkgSha256, "RELEASE_PUBLIC_LKG_INVALID");
    assertSourceRegistrySchema(database);
    const version = Number((database.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version);
    assert(version === 10, "RELEASE_DATABASE_SCHEMA_DOWNGRADE");
    const autoReview = Number((database.prepare(
      "SELECT COUNT(*) AS count FROM internal_operation WHERE owner_process='automatic_reviewer'"
    ).get() as Record<string, unknown>).count);
    const autoPublish = Number((database.prepare(
      "SELECT COUNT(*) AS count FROM internal_operation WHERE owner_process='automatic_publisher'"
    ).get() as Record<string, unknown>).count);
    assert(autoReview === 0 && autoPublish === 0, "RELEASE_AUTOMATION_REGISTRATION_NONZERO");
    const externalCalls = (database.prepare(
      "SELECT external_calls FROM internal_external_attempt"
    ).all() as Array<Record<string, unknown>>).reduce((total, row) => total + Number(row.external_calls), 0);
    assert(Number.isSafeInteger(externalCalls) && externalCalls >= 0, "RELEASE_EXTERNAL_CALL_COUNT_INVALID");
    const outboxRows = count(database, "projection_outbox") +
      count(database, "internal_operation_outbox") +
      count(database, "bilingual_publication_outbox_v1");
    const idempotencyRows = count(database, "internal_operation") +
      count(database, "internal_external_attempt") +
      outboxRows;
    return Object.freeze({
      activationId: gate.receipt.activationId,
      previousActivationId: gate.receipt.previousActivationId,
      pairId: gate.receipt.pairId,
      releaseId: gate.receipt.releaseId,
      role: gate.receipt.role,
      manifestSha256: gate.receipt.manifestSha256,
      schemaVersion: 10 as const,
      schemaSha256: SOURCE_REGISTRY_SCHEMA10_SHA256,
      databaseLogicalSha256: releaseDatabaseLogicalSha256(database),
      outboxRows,
      idempotencyRows,
      externalCalls,
      automaticReviewRegistrations: 0 as const,
      automaticPublishRegistrations: 0 as const,
      publicLkgSha256
    });
  });
}

export function buildReleaseSwitchReceipt(
  pair: ReleasePairReceipt,
  fullBefore: ReleaseRuntimeObservation,
  fallbackAfter: ReleaseRuntimeObservation,
  rollbackAfter: ReleaseRuntimeObservation
): ReleaseSwitchReceipt {
  assert(
    fullBefore.releaseId === pair.fullReleaseId &&
    fallbackAfter.releaseId === pair.fallbackReleaseId &&
    rollbackAfter.releaseId === pair.fullReleaseId,
    "RELEASE_SWITCH_IDENTITY_MISMATCH"
  );
  assert(
    fullBefore.pairId === pair.pairId && fallbackAfter.pairId === pair.pairId && rollbackAfter.pairId === pair.pairId &&
    fullBefore.role === "full_v10" && fallbackAfter.role === "manual_only_fallback_v10" && rollbackAfter.role === "full_v10" &&
    fullBefore.previousActivationId === null &&
    fallbackAfter.previousActivationId === fullBefore.activationId &&
    rollbackAfter.previousActivationId === fallbackAfter.activationId,
    "RELEASE_SWITCH_ACTIVATION_INVALID"
  );
  for (const observation of [fullBefore, fallbackAfter, rollbackAfter]) {
    assert(observation.schemaVersion === 10 && observation.schemaSha256 === pair.schemaSha256, "RELEASE_SWITCH_SCHEMA_MISMATCH");
    assert(observation.automaticReviewRegistrations === 0 && observation.automaticPublishRegistrations === 0, "RELEASE_SWITCH_AUTOMATION_NONZERO");
  }
  assert(
    fullBefore.databaseLogicalSha256 === fallbackAfter.databaseLogicalSha256 &&
    fallbackAfter.databaseLogicalSha256 === rollbackAfter.databaseLogicalSha256 &&
    fullBefore.publicLkgSha256 === fallbackAfter.publicLkgSha256 &&
    fallbackAfter.publicLkgSha256 === rollbackAfter.publicLkgSha256 &&
    fullBefore.externalCalls === fallbackAfter.externalCalls &&
    fallbackAfter.externalCalls === rollbackAfter.externalCalls,
    "RELEASE_SWITCH_STATE_DRIFT"
  );
  assert(
    fullBefore.outboxRows === fallbackAfter.outboxRows && fallbackAfter.outboxRows === rollbackAfter.outboxRows,
    "RELEASE_SWITCH_OUTBOX_DRIFT"
  );
  assert(
    fullBefore.idempotencyRows === fallbackAfter.idempotencyRows &&
    fallbackAfter.idempotencyRows === rollbackAfter.idempotencyRows,
    "RELEASE_SWITCH_IDEMPOTENCY_DRIFT"
  );
  const fullBeforeSha256 = hash(canonicalJsonV1(fullBefore));
  const fallbackAfterSha256 = hash(canonicalJsonV1(fallbackAfter));
  const rollbackAfterSha256 = hash(canonicalJsonV1(rollbackAfter));
  return Object.freeze({
    schemaVersion: "f1plus1-release-switch-v10",
    pairId: pair.pairId,
    fullBeforeSha256,
    fallbackAfterSha256,
    rollbackAfterSha256,
    fallbackTransitionSha256: hash(`f1plus1-release-switch-to-fallback-v10\n${canonicalJsonV1({ pairId: pair.pairId, fullBeforeSha256, fallbackAfterSha256 })}`),
    rollbackTransitionSha256: hash(`f1plus1-release-switch-rollback-v10\n${canonicalJsonV1({ pairId: pair.pairId, fallbackAfterSha256, rollbackAfterSha256 })}`),
    databaseUnchanged: true,
    outboxUnchanged: true,
    idempotencyUnchanged: true,
    automaticReviewRegistrations: 0,
    automaticPublishRegistrations: 0
  });
}
