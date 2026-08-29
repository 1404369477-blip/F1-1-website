#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { hostname } from "node:os";
import { DatabaseSync } from "node:sqlite";
import process from "node:process";

import { canonicalJson } from "../src/server/db/profile.ts";
import { acquireQuiescedSchema6, type LiveBase } from "../src/server/admin-service/quiesce-fence.ts";
import {
  promoteStagedProduction,
  stageSchema6To10,
  type PromotionResult
} from "../src/server/admin-service/production-apply.ts";
import type { SourceRegistryMigrationManifest } from "../src/server/rss/source-registry-migration.ts";
import { hashReleaseManifest, type ReleaseCandidateManifest } from "../src/server/internal-operation/release.ts";

const MANIFEST_SCHEMA_VERSION = "f1plus1-admin-production-migrate-v10-manifest-v1" as const;
const RECEIPT_SCHEMA_VERSION = "f1plus1-admin-production-migrate-v10-receipt-v1" as const;
const DEFAULT_CUTOVER_ROOT = "/Users/chanai/Library/Application Support/F1Plus1/Admin/v10-cutover";
const PRODUCTION_LIVE_DB_PATH = "/Users/chanai/F1-1-website/app/.local/f1plus1-rss-real-private.sqlite";
const CANDIDATE_ROOT = "/Users/chanai/F1-1-website/releases/candidate-v10-20260828-1110";
const CANDIDATE_APP_ROOT = join(CANDIDATE_ROOT, "app");
const OFFICIAL_MANIFEST_PATH = join(CANDIDATE_APP_ROOT, ".local/release/admin-service-release-manifest.json");
const FULL_MANIFEST_PATH = join(CANDIDATE_APP_ROOT, ".local/release/full_v10.manifest.json");
const FALLBACK_MANIFEST_PATH = join(CANDIDATE_APP_ROOT, ".local/release/manual_only_fallback_v10.manifest.json");
const PAIR_RECEIPT_PATH = join(CANDIDATE_APP_ROOT, ".local/release/release-pair.receipt.json");
const MIGRATION_ROOT = "/Users/chanai/Documents/F1+1/app/migrations/rss-real";
const TARGET_NODE_PATH = "/Users/chanai/.local/node-v24.18.0-darwin-arm64/bin/node";
const TARGET_NPM_PATH = "/Users/chanai/.local/node-v24.18.0-darwin-arm64/bin/npm";
const OFFICIAL_MANIFEST_SHA256 = "779b74a7672a426e4306d088429b4b8e69e629e966298ea906fb6c0a923731e3";
const FULL_MANIFEST_SHA256 = "6a1b01a1cbb807097ebf15577a76c3afd0cb49a17567993d1a2650e8385a4eee";
const FALLBACK_MANIFEST_SHA256 = "769e78f527d405610e5af23cc79588e54754c72a83c559c4eb21b37eb528828f";
const PAIR_RECEIPT_SHA256 = "505d0f9bc6cef41472f361f21f6db5b006af832fddbd2d0a0221fa9d49e7a9b5";
const CANDIDATE_APP_ROOT_SHA256 = "7e003f95a7992d3950355b126c24cddb7548d36f2133b04df69807955cf6ede5";
const SOURCE_REGISTRY_X_SET_SHA256 = "bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b";

class ProductionMigrationError extends Error {
  readonly code: string;
  constructor(code: string, message?: string) {
    super(message === undefined ? code : `${code}: ${message}`);
    this.name = "ProductionMigrationError";
    this.code = code;
  }
}

type CutoverManifest = Readonly<{
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  hostname: string;
  uid: number;
  live: {
    path: string;
    dev: number;
    ino: number;
    hash: string;
    schema6: true;
  };
  candidate: {
    root: string;
    appRoot: string;
    appRootHash: string;
    officialManifestPath: string;
    officialManifestHash: string;
    fullManifestPath: string;
    fullManifestHash: string;
    fallbackManifestPath: string;
    fallbackManifestHash: string;
    pairReceiptPath: string;
    pairReceiptHash: string;
  };
  artifactPaths: {
    migrationRoot: string;
    manifestPath: string;
    manifestSha256Path: string;
    receiptPath: string;
    stageRoot: string;
    backupPath: string;
    cutoverReceiptPath: string;
  };
  toolchain: { nodePath: string; nodeVersion: "v24.18.0"; npmPath: string; npmVersion: "11.16.0" };
  migrations: { version: 7 | 8 | 9 | 10; file: string; sha256: string }[];
  sourceRegistry: {
    schemaVersion: "source-registry-migration-manifest-v1";
    migratedAt: "2026-08-25T00:00:00.000Z";
    rssCount: 4;
    xInventoryCount: 59;
    xInventorySetSha256: string;
    manifest: SourceRegistryMigrationManifest;
  };
  targetSchema10: true;
  phase: "disabled";
  globalStopped: true;
  recoveryFenced: true;
  automaticReview: 0;
  automaticPublish: 0;
  automaticOutbox: 0;
  xAutomation: false;
  admin: { host: "127.0.0.1"; port: 3101; tailscaleOnly: true };
  public: { host: "127.0.0.1"; port: 3000 };
}>;

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function fail(code: string, message?: string): never {
  throw new ProductionMigrationError(code, message);
}

function currentUid(): number {
  const uid = process.getuid?.();
  if (uid === undefined) fail("UID_UNAVAILABLE");
  return uid;
}

function liveDbPath(): string {
  const override = process.env.F1_V10_LIVE_DB_PATH;
  if (override === undefined) return PRODUCTION_LIVE_DB_PATH;
  if (process.env.NODE_ENV !== "test") fail("LIVE_DB_OVERRIDE_ONLY_FOR_TEST");
  const path = resolve(override);
  if (path === PRODUCTION_LIVE_DB_PATH) fail("TEST_LIVE_DB_MUST_NOT_EQUAL_PRODUCTION");
  return realpathSync(path);
}

function assertPrivateRegularFile(path: string, code: string): void {
  const descriptor = lstatSync(path);
  if (!descriptor.isFile() || descriptor.isSymbolicLink() || descriptor.nlink !== 1) fail(code);
  if ((descriptor.mode & 0o077) !== 0) fail(code);
  if (descriptor.uid !== currentUid()) fail(code);
}

function assertPrivateOwnedDirectory(path: string, code: string): void {
  const descriptor = lstatSync(path);
  if (!descriptor.isDirectory() || descriptor.isSymbolicLink()) fail(code);
  if ((descriptor.mode & 0o077) !== 0) fail(code);
  if (descriptor.uid !== currentUid()) fail(code);
}

function assertRealDirectory(path: string, code: string): string {
  const descriptor = lstatSync(path);
  if (!descriptor.isDirectory() || descriptor.isSymbolicLink()) fail(code);
  if (descriptor.uid !== currentUid()) fail(code);
  return realpathSync(path);
}

function readLiveBase(path: string): LiveBase {
  const canonical = realpathSync(path);
  const descriptor = lstatSync(canonical);
  if (!descriptor.isFile() || descriptor.isSymbolicLink() || descriptor.nlink !== 1) fail("LIVE_FILE_INVALID");
  if ((descriptor.mode & 0o077) !== 0 || descriptor.uid !== currentUid()) fail("LIVE_FILE_INVALID");
  let userVersion = 0;
  const database = new DatabaseSync(canonical, { readOnly: true });
  try {
    userVersion = Number((database.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version);
  } finally {
    database.close();
  }
  if (userVersion !== 6) fail("LIVE_NOT_SCHEMA6", `user_version=${userVersion}`);
  return {
    path: canonical,
    pathSha256: sha256(canonical),
    dev: descriptor.dev,
    ino: descriptor.ino,
    nlink: descriptor.nlink,
    uid: descriptor.uid,
    mode: descriptor.mode & 0o7777,
    sha256: sha256(readFileSync(canonical)),
    userVersion,
    dataVersion: 0,
    walState: existsSync(`${canonical}-wal`) && statSync(`${canonical}-wal`).size > 0 ? "present" : "absent_or_empty"
  };
}

function assertToolchain(): void {
  if (process.execPath !== TARGET_NODE_PATH || process.version !== "v24.18.0") fail("NODE_TOOLCHAIN_DRIFT", process.execPath);
  const nodeDescriptor = lstatSync(TARGET_NODE_PATH);
  if (!nodeDescriptor.isFile() || nodeDescriptor.isSymbolicLink() || nodeDescriptor.uid !== currentUid()) fail("NODE_BINARY_INVALID");
  if (sha256(readFileSync(TARGET_NODE_PATH)) !== "ee6fb0e015284d83a91e8ec5213f43a157f8a392b58555301682892ba928c04a") fail("NODE_BINARY_HASH_DRIFT");
  if (realpathSync(TARGET_NPM_PATH) !== "/Users/chanai/.local/node-v24.18.0-darwin-arm64/lib/node_modules/npm/bin/npm-cli.js") fail("NPM_BINARY_INVALID");
  if (sha256(readFileSync(realpathSync(TARGET_NPM_PATH))) !== "8e5f6f3429f8cdbe693cdc29904e9d5a7b127a494bd15c804bd54c7403bfcbe7") fail("NPM_LAUNCHER_HASH_DRIFT");
}

function sourceRegistryManifest(): SourceRegistryMigrationManifest {
  const rss = [
    { sourceId: "motorsport-f1-news", displayName: "Motorsport.com", feedUrl: "https://www.motorsport.com/rss/f1/news/", siteUrl: "https://www.motorsport.com/", routeId: "rss-route-motorsport" },
    { sourceId: "autosport-f1-news", displayName: "Autosport", feedUrl: "https://www.autosport.com/rss/f1/news/", siteUrl: "https://www.autosport.com/", routeId: "rss-route-autosport" },
    { sourceId: "racefans-f1-news", displayName: "RaceFans", feedUrl: "https://www.racefans.net/category/formula-1/feed/", siteUrl: "https://www.racefans.net/", routeId: "rss-route-racefans" },
    { sourceId: "the-race-f1-news", displayName: "The Race", feedUrl: "https://www.the-race.com/category/formula-1/rss/", siteUrl: "https://www.the-race.com/", routeId: "rss-route-the-race" }
  ].map((entry) => ({
    ...entry,
    scheduleSeconds: 900,
    routeIdentitySha256: "1".repeat(64),
    routeReleaseSha256: "2".repeat(64),
    routeManifestSha256: "3".repeat(64),
    rightsStatus: "clear" as const,
    mediaPolicy: "allowlisted" as const,
    authorizationExpiresAt: "2027-08-25T00:00:00.000Z",
    authorizationReceiptSha256: "4".repeat(64),
    sourcePolicySha256: "5".repeat(64)
  }));
  return { schemaVersion: "source-registry-migration-manifest-v1", migratedAt: "2026-08-25T00:00:00.000Z", rss };
}

function migrationHashes(): CutoverManifest["migrations"] {
  const files = [
    [7, "0007_internal_operation_recovery_phase.sql"],
    [8, "0008_x_manual_inbox.sql"],
    [9, "0009_bilingual_refinement.sql"],
    [10, "0010_source_registry.sql"]
  ] as const;
  return files.map(([version, file]) => ({ version, file, sha256: sha256(readFileSync(join(MIGRATION_ROOT, file))) }));
}

function candidateTreeHash(root: string): string {
  assertRealDirectory(root, "CANDIDATE_ROOT_INVALID");
  const rootReal = realpathSync(root);
  const paths: string[] = [];
  const visit = (path: string): void => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isSymbolicLink()) {
        const target = realpathSync(dirname(child) + "/" + readlinkSync(child));
        const contained = relative(rootReal, target);
        if (contained === ".." || contained.startsWith("../")) fail("CANDIDATE_SYMLINK_ESCAPES_ROOT", child);
        paths.push(`${relative(root, child)}\0symlink\0${readlinkSync(child)}`);
        continue;
      }
      if (entry.isDirectory()) {
        paths.push(child.slice(root.length + 1));
        visit(child);
      } else if (entry.isFile()) {
        continue;
      } else fail("CANDIDATE_ENTRY_INVALID", child);
    }
  };
  visit(root);
  return sha256(paths.sort().map((path) => `${path}\n`).join(""));
}

function assertCandidate(candidateRoot: string): void {
  assertRealDirectory(candidateRoot, "CANDIDATE_ROOT_INVALID");
  if (candidateTreeHash(join(candidateRoot, "app")) !== CANDIDATE_APP_ROOT_SHA256) fail("CANDIDATE_APP_ROOT_HASH_DRIFT");
  for (const [path, expected] of [
    [OFFICIAL_MANIFEST_PATH, OFFICIAL_MANIFEST_SHA256],
    [PAIR_RECEIPT_PATH, PAIR_RECEIPT_SHA256]
  ] as const) {
    assertPrivateRegularFile(path, "CANDIDATE_ARTIFACT_INVALID");
    if (sha256(readFileSync(path)) !== expected) fail("CANDIDATE_ARTIFACT_HASH_DRIFT", path);
  }
  assertPrivateRegularFile(FULL_MANIFEST_PATH, "CANDIDATE_ARTIFACT_INVALID");
  assertPrivateRegularFile(FALLBACK_MANIFEST_PATH, "CANDIDATE_ARTIFACT_INVALID");
  const full = JSON.parse(readFileSync(FULL_MANIFEST_PATH, "utf8")) as ReleaseCandidateManifest;
  const fallback = JSON.parse(readFileSync(FALLBACK_MANIFEST_PATH, "utf8")) as ReleaseCandidateManifest;
  if (hashReleaseManifest(full) !== FULL_MANIFEST_SHA256 || hashReleaseManifest(fallback) !== FALLBACK_MANIFEST_SHA256) fail("CANDIDATE_ARTIFACT_HASH_DRIFT");
}

function assertMigrationFiles(): void {
  assertRealDirectory(MIGRATION_ROOT, "MIGRATION_ROOT_INVALID");
  for (const migration of migrationHashes()) {
    const path = join(MIGRATION_ROOT, migration.file);
    const descriptor = lstatSync(path);
    if (!descriptor.isFile() || descriptor.isSymbolicLink() || descriptor.nlink !== 1) fail("MIGRATION_FILE_INVALID");
    if (sha256(readFileSync(path)) !== migration.sha256) fail("MIGRATION_FILE_HASH_DRIFT", path);
  }
}

function assertTestRootAllowed(rootInput: string | undefined): void {
  if ((rootInput !== undefined || process.env.F1_V10_CUTOVER_ROOT !== undefined) && process.env.NODE_ENV !== "test") {
    fail("CUTOVER_ROOT_OVERRIDE_ONLY_FOR_TEST");
  }
}

function atomicPrivateWrite(path: string, bytes: string): void {
  const temporary = `${path}.tmp-${Math.random().toString(36).slice(2)}`;
  try {
    const descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try {
      writeSync(descriptor, bytes);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    chmodSync(temporary, 0o600);
    renameSync(temporary, path);
    const directory = openSync(dirname(path), constants.O_RDONLY);
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  } finally {
    if (existsSync(temporary)) {
      try {
        const descriptor = lstatSync(temporary);
        if (descriptor.isFile() && descriptor.isSymbolicLink() === false) {
          unlinkSync(temporary);
        }
      } catch {}
    }
  }
}

function runPrepare(rootInput?: string): CutoverManifest {
  assertTestRootAllowed(rootInput);
  const root = rootInput === undefined ? DEFAULT_CUTOVER_ROOT : resolve(rootInput);
  if (rootInput !== undefined && root === DEFAULT_CUTOVER_ROOT) fail("TEST_ROOT_MUST_NOT_EQUAL_PRODUCTION_ROOT");
  if (process.execPath !== TARGET_NODE_PATH || process.version !== "v24.18.0") fail("NODE_TOOLCHAIN_DRIFT");
  assertToolchain();
  assertPrivateOwnedDirectory(dirname(root), "CUTOVER_PARENT_INVALID");
  if (!existsSync(root)) mkdirSync(root, { mode: 0o700, recursive: false });
  assertPrivateOwnedDirectory(root, "CUTOVER_ROOT_INVALID");
  mkdirSync(join(root, "stage"), { mode: 0o700, recursive: false });
  assertPrivateOwnedDirectory(join(root, "stage"), "STAGE_ROOT_INVALID");
  assertCandidate(CANDIDATE_ROOT);
  assertMigrationFiles();
  const live = readLiveBase(liveDbPath());
  const sourceManifest = sourceRegistryManifest();
  const migrations = migrationHashes();
  const manifest: CutoverManifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    hostname: hostname(),
    uid: currentUid(),
    live: { path: live.path, dev: live.dev, ino: live.ino, hash: live.sha256, schema6: true },
    candidate: {
      root: CANDIDATE_ROOT,
      appRoot: CANDIDATE_APP_ROOT,
      appRootHash: CANDIDATE_APP_ROOT_SHA256,
      officialManifestPath: OFFICIAL_MANIFEST_PATH,
      officialManifestHash: OFFICIAL_MANIFEST_SHA256,
      fullManifestPath: FULL_MANIFEST_PATH,
      fullManifestHash: FULL_MANIFEST_SHA256,
      fallbackManifestPath: FALLBACK_MANIFEST_PATH,
      fallbackManifestHash: FALLBACK_MANIFEST_SHA256,
      pairReceiptPath: PAIR_RECEIPT_PATH,
      pairReceiptHash: PAIR_RECEIPT_SHA256
    },
    artifactPaths: {
      migrationRoot: MIGRATION_ROOT,
      manifestPath: join(root, "manifest.canonical.json"),
      manifestSha256Path: join(root, "manifest.sha256"),
      receiptPath: join(root, "prepare.receipt.json"),
      stageRoot: join(root, "stage"),
      backupPath: join(dirname(live.path), "f1plus1-rss-real-private.sqlite.v10-cutover.backup"),
      cutoverReceiptPath: join(root, "cutover.receipt.json")
    },
    toolchain: { nodePath: TARGET_NODE_PATH, nodeVersion: "v24.18.0", npmPath: TARGET_NPM_PATH, npmVersion: "11.16.0" },
    migrations,
    sourceRegistry: {
      schemaVersion: "source-registry-migration-manifest-v1",
      migratedAt: "2026-08-25T00:00:00.000Z",
      rssCount: 4,
      xInventoryCount: 59,
      xInventorySetSha256: SOURCE_REGISTRY_X_SET_SHA256,
      manifest: sourceManifest
    },
    targetSchema10: true,
    phase: "disabled",
    globalStopped: true,
    recoveryFenced: true,
    automaticReview: 0,
    automaticPublish: 0,
    automaticOutbox: 0,
    xAutomation: false,
    admin: { host: "127.0.0.1", port: 3101, tailscaleOnly: true },
    public: { host: "127.0.0.1", port: 3000 }
  };
  const manifestJson = canonicalJson(manifest);
  const manifestHash = sha256(manifestJson);
  const prepareReceipt = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    state: "prepared",
    preparedAt: new Date().toISOString(),
    manifestSha256: manifestHash,
    livePath: live.path,
    candidateAppRootSha256: CANDIDATE_APP_ROOT_SHA256,
    productionWrites: 0
  };
  const prepareReceiptJson = canonicalJson(prepareReceipt);
  atomicPrivateWrite(join(root, "manifest.canonical.json"), manifestJson);
  atomicPrivateWrite(join(root, "manifest.sha256"), `${manifestHash}\n`);
  atomicPrivateWrite(join(root, "prepare.receipt.json"), prepareReceiptJson);
  return manifest;
}

function readPreparedManifest(root: string, expectedSha256: string): CutoverManifest {
  const manifestPath = join(root, "manifest.canonical.json");
  const receiptPath = join(root, "manifest.sha256");
  assertPrivateRegularFile(manifestPath, "CUTOVER_MANIFEST_INVALID");
  assertPrivateRegularFile(receiptPath, "CUTOVER_MANIFEST_SHA_INVALID");
  const bytes = readFileSync(manifestPath);
  const receipt = readFileSync(receiptPath, "utf8").trim();
  if (receipt !== expectedSha256) fail("MANIFEST_SHA_ENV_MISMATCH");
  if (sha256(bytes) !== expectedSha256) fail("MANIFEST_HASH_MISMATCH");
  const manifest = JSON.parse(bytes.toString("utf8")) as CutoverManifest;
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) fail("MANIFEST_SCHEMA_DRIFT");
  if (manifest.hostname !== hostname() || manifest.uid !== currentUid()) fail("MANIFEST_HOST_IDENTITY_DRIFT");
  if (manifest.live.path !== liveDbPath() || manifest.live.schema6 !== true) fail("MANIFEST_LIVE_PATH_DRIFT");
  if (manifest.candidate.root !== CANDIDATE_ROOT || manifest.candidate.appRoot !== CANDIDATE_APP_ROOT) fail("MANIFEST_CANDIDATE_PATH_DRIFT");
  if (manifest.candidate.appRootHash !== CANDIDATE_APP_ROOT_SHA256 || manifest.candidate.officialManifestHash !== OFFICIAL_MANIFEST_SHA256 ||
      manifest.candidate.fullManifestHash !== FULL_MANIFEST_SHA256 || manifest.candidate.fallbackManifestHash !== FALLBACK_MANIFEST_SHA256 ||
      manifest.candidate.pairReceiptHash !== PAIR_RECEIPT_SHA256) fail("MANIFEST_CANDIDATE_HASH_DRIFT");
  if (manifest.toolchain.nodePath !== TARGET_NODE_PATH || manifest.toolchain.nodeVersion !== "v24.18.0" ||
      manifest.toolchain.npmPath !== TARGET_NPM_PATH || manifest.toolchain.npmVersion !== "11.16.0") fail("MANIFEST_TOOLCHAIN_DRIFT");
  if (manifest.targetSchema10 !== true || manifest.phase !== "disabled" || manifest.globalStopped !== true || manifest.recoveryFenced !== true ||
      manifest.automaticReview !== 0 || manifest.automaticPublish !== 0 || manifest.automaticOutbox !== 0 || manifest.xAutomation !== false ||
      manifest.admin.host !== "127.0.0.1" || manifest.admin.port !== 3101 || manifest.admin.tailscaleOnly !== true ||
      manifest.public.host !== "127.0.0.1" || manifest.public.port !== 3000) fail("MANIFEST_CUTOVER_POLICY_DRIFT");
  if (manifest.sourceRegistry.manifest.rss.length !== manifest.sourceRegistry.rssCount) fail("SOURCE_MANIFEST_COUNT_DRIFT");
  return manifest;
}

function assertLiveMatchesExpected(manifest: CutoverManifest): LiveBase {
  const live = readLiveBase(manifest.live.path);
  if (live.path !== manifest.live.path || live.dev !== manifest.live.dev || live.ino !== manifest.live.ino || live.sha256 !== manifest.live.hash) {
    fail("LIVE_IDENTITY_DRIFT");
  }
  return live;
}

async function runApply(rootInput?: string): Promise<PromotionResult> {
  assertTestRootAllowed(rootInput);
  if (process.env.F1_WRITERS_CONFIRMED_STOPPED !== "1") fail("WRITERS_CONFIRMATION_REQUIRED");
  const expectedManifestSha = process.env.F1_V10_CUTOVER_MANIFEST_SHA256;
  if (expectedManifestSha === undefined || !/^[0-9a-f]{64}$/u.test(expectedManifestSha)) fail("MANIFEST_SHA_REQUIRED");
  const root = rootInput === undefined ? DEFAULT_CUTOVER_ROOT : resolve(rootInput);
  if (rootInput !== undefined && root === DEFAULT_CUTOVER_ROOT) fail("TEST_ROOT_MUST_NOT_EQUAL_PRODUCTION_ROOT");
  assertToolchain();
  assertPrivateOwnedDirectory(root, "CUTOVER_ROOT_INVALID");
  const manifest = readPreparedManifest(root, expectedManifestSha);
  assertCandidate(CANDIDATE_ROOT);
  assertMigrationFiles();
  const live = assertLiveMatchesExpected(manifest);
  const quiesced = acquireQuiescedSchema6(live.path);
  try {
    // Acquiring the fence intentionally checkpoints and truncates a pending WAL.
    // That can change the main-file hash without changing logical data, so bind
    // the held database by its already-verified file identity and schema here.
    if (
      quiesced.base.path !== manifest.live.path ||
      quiesced.base.dev !== manifest.live.dev ||
      quiesced.base.ino !== manifest.live.ino ||
      quiesced.base.userVersion !== 6
    ) fail("LIVE_QUIESCE_IDENTITY_DRIFT");
    const stage = await stageSchema6To10({
      stageRoot: manifest.artifactPaths.stageRoot,
      migrationRoot: MIGRATION_ROOT,
      sourceRegistryManifest: manifest.sourceRegistry.manifest,
      quiescedLive: quiesced
    });
    const promotion = await promoteStagedProduction({
      stageResult: stage,
      quiescedLive: quiesced,
      backupPath: manifest.artifactPaths.backupPath
    });
    const promotedDatabase = new DatabaseSync(live.path, { readOnly: true });
    let promotedSchema: number;
    try {
      promotedSchema = Number((promotedDatabase.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version);
    } finally {
      promotedDatabase.close();
    }
    if (promotedSchema !== 10) fail("PROMOTED_NOT_SCHEMA10");
    const receipt = {
      schemaVersion: RECEIPT_SCHEMA_VERSION,
      state: "promoted",
      promotedAt: new Date().toISOString(),
      manifestSha256: expectedManifestSha,
      live: { path: live.path, dev: promotion.receipt.new.dev, ino: promotion.receipt.new.ino, hash: promotion.receipt.new.sha256, schema: promotedSchema },
      backupPath: promotion.backupPath,
      promotionReceiptSha256: promotion.receiptSha256,
      serviceActions: 0,
      networkActions: 0
    };
    atomicPrivateWrite(manifest.artifactPaths.cutoverReceiptPath, canonicalJson(receipt));
    return promotion;
  } catch (error) {
    try {
      quiesced.abortAndRelease();
    } catch (releaseError) {
      fail("QUIESCE_RELEASE_FAILED", `${error instanceof Error ? error.message : String(error)} / ${releaseError instanceof Error ? releaseError.message : String(releaseError)}`);
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const [command, root] = process.argv.slice(2);
  if (command === "--help" || command === "-h" || command === undefined) {
    process.stdout.write(`Usage: npm run admin:migrate-v10 -- prepare|apply [F1_V10_CUTOVER_ROOT]\n`);
    return;
  }
  if (root !== undefined && process.env.F1_V10_CUTOVER_ROOT !== undefined && process.env.F1_V10_CUTOVER_ROOT !== root) {
    fail("ROOT_ARGUMENT_ENV_CONFLICT");
  }
  if (command === "prepare") {
    const manifest = runPrepare(root ?? process.env.F1_V10_CUTOVER_ROOT);
    process.stdout.write(`${JSON.stringify({ state: "prepared", manifestSha256: sha256(canonicalJson(manifest)) })}\n`);
    return;
  }
  if (command === "apply") {
    const promotion = await runApply(root ?? process.env.F1_V10_CUTOVER_ROOT);
    process.stdout.write(`${JSON.stringify({
      state: "promoted",
      schema: 10,
      newDbHash: promotion.receipt.new.sha256,
      newDbDev: promotion.receipt.new.dev,
      newDbIno: promotion.receipt.new.ino,
      backupPath: promotion.backupPath,
      promotionReceiptSha256: promotion.receiptSha256
    })}\n`);
    return;
  }
  fail("USAGE_INVALID");
}

await main();
