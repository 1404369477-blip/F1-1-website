import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fchmodSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { assertNodeVersion, ConfigError } from "../config/env.ts";
import {
  assertAdminBuildClosure,
  deriveAdminBuildClosure,
  type AdminBuildClosure
} from "../release/build-closure.ts";
import {
  assertRuntimeGitClosure,
  assertRuntimeLocalClosure,
  deriveRuntimeLocalClosure,
  gitBlobSha1,
  readStableRegularFile
} from "../release/local-closure.ts";

export const ADMIN_RELEASE_MANIFEST_SCHEMA = "f1plus1-runtime-release-manifest-v2" as const;
export const ADMIN_RELEASE_MANIFEST_PATH = ".local/release/admin-service-release-manifest.json" as const;

export const ADMIN_RELEASE_RUNTIME_FILES = [
  ".env.example",
  ".node-version",
  ".npmrc",
  ".nvmrc",
  "migrations/rss-real/0001_rss_real.sql",
  "migrations/rss-real/0002_admin_review_publish.sql",
  "migrations/rss-real/0003_projection_delivery_runtime.sql",
  "migrations/rss-real/0004_rss_media_and_chinese_refinement.sql",
  "migrations/rss-real/0005_second_rss_autosport.sql",
  "migrations/rss-real/0006_independent_rss_racefans_the_race.sql",
  "migrations/rss-real/0007_internal_operation_recovery_phase.sql",
  "migrations/rss-real/0008_x_manual_inbox.sql",
  "migrations/rss-real/0009_bilingual_refinement.sql",
  "migrations/rss-real/0010_source_registry.sql",
  "migrations/tweet-inbox/0001_tweet_inbox.sql",
  "package-lock.json",
  "package.json",
  "scripts/admin-release-build.ts",
  "next-env.d.ts",
  "next.config.ts",
  "scripts/admin-build-release-manifest.ts",
  "scripts/admin-install-macos.ts",
  "scripts/admin-service.ts",
  "scripts/admin-verify-release-stage.ts",
  "scripts/install-macos-public-beta-core.ts",
  "scripts/install-macos-public-beta.ts",
  "scripts/projection-sender.ts",
  "scripts/quick-launch-auto-zero.ts",
  "scripts/quick-launch-enter-live.ts",
  "scripts/quick-launch-handoff-pool.ts",
  "scripts/quick-launch-processing-preflight.ts",
  "scripts/quick-launch-schedule-observer.ts",
  "scripts/rss-collect-once.ts",
  "scripts/rss-refine-once.ts",
  "scripts/rss-scheduled-run.ts",
  "scripts/public-projection-runtime.ts",
  "scripts/public-release-refresh.ts",
  "scripts/serve.ts",
  "src/admin-ui/app.css",
  "src/admin-ui/app.js",
  "src/admin-ui/index.html",
  "src/admin-ui/x-management.html",
  "src/admin-ui/x-management.js",
  "src/app/api/health/route.ts",
  "src/app/api/public/feed/route.ts",
  "src/app/api/public/stories/[publicId]/route.ts",
  "src/app/globals.css",
  "src/app/layout.tsx",
  "src/app/page.tsx",
  "src/app/stories/[publicId]/not-found.tsx",
  "src/app/stories/[publicId]/page.tsx",
  "src/components/f1/f1-page-shell.tsx",
  "src/components/f1/story-parts.tsx",
  "src/components/f1/theme-preference.ts",
  "src/features/stories/feed-experience.tsx",
  "src/features/stories/editorial.ts",
  "src/features/stories/hash-params.ts",
  "src/features/stories/public-api.ts",
  "src/features/stories/story-detail-experience.tsx",
  "src/features/stories/timeline-search.ts",
  "src/modules/story/event-cluster.ts",
  "src/server/admin-service/auth.ts",
  "src/server/admin-service/bilingual-admin.ts",
  "src/server/admin-service/bilingual-retry.ts",
  "src/server/admin-service/bilingual-projection-exporter.ts",
  "src/server/admin-service/bilingual-projection-writer.ts",
  "src/server/admin-service/deployment.ts",
  "src/server/admin-service/quiesce-absence-guard.ts",
  "src/server/admin-service/release-manifest.ts",
  "src/server/admin-service/runtime.ts",
  "src/server/admin-service/server.ts",
  "src/server/admin-service/storage.ts",
  "src/server/admin-service/webauthn.ts",
  "src/server/internal-operation/authorizer.ts",
  "src/server/internal-operation/gateway.ts",
  "src/server/internal-operation/handoff-pool.ts",
  "src/server/internal-operation/mutation-port.ts",
  "src/server/internal-operation/quick-launch-control.ts",
  "src/server/internal-operation/quick-launch-processing.ts",
  "src/server/internal-operation/owner-supervisor.ts",
  "src/server/internal-operation/phase.ts",
  "src/server/internal-operation/recovery.ts",
  "src/server/internal-operation/release.ts",
  "src/server/internal-operation/trusted-local-bootstrap.ts",
  "src/server/quick-launch/auto-zero-vector.ts",
  "src/server/tweet-inbox/repository.ts",
  "src/server/tweet-inbox/types.ts",
  "src/server/tweet-inbox/url.ts",
  "src/server/release/local-closure.ts",
  "src/server/release/build-closure.ts",
  "src/server/config/capabilities.ts",
  "src/server/config/env.ts",
  "src/server/config/registry.ts",
  "src/server/db/closed-receipt.ts",
  "src/server/db/database.ts",
  "src/server/db/profile.ts",
  "src/server/db/public-multimedia-synthetic.ts",
  "src/server/db/public-synthetic.ts",
  "src/server/db/seed.ts",
  "src/server/db/source-management-synthetic.ts",
  "src/server/db/source.ts",
  "src/server/health.ts",
  "src/server/providers/fixture.ts",
  "src/server/providers/source-fixture.ts",
  "src/server/public/cursor.ts",
  "src/server/public/bilingual-snapshot.ts",
  "src/server/public/deployment.ts",
  "src/server/public/error.ts",
  "src/server/public/http.ts",
  "src/server/public/repository.ts",
  "src/server/public/release-manifest.ts",
  "src/server/public/runtime.ts",
  "src/server/public/snapshot-adapter.ts",
  "src/server/public/timeline.ts",
  "src/server/public/types.ts",
  "src/server/review-real/backend.ts",
  "src/server/review-real/error.ts",
  "src/server/review-real/mapping.ts",
  "src/server/review-real/migration.ts",
  "src/server/review-real/projection.ts",
  "src/server/review-real/receiver-http.ts",
  "src/server/review-real/repository.ts",
  "src/server/review-real/routes.ts",
  "src/server/review-real/schema.ts",
  "src/server/review-real/security.ts",
  "src/server/review-real/sender.ts",
  "src/server/rss/repository.ts",
  "src/server/rss/article-batch.ts",
  "src/server/rss/sources.ts",
  "src/server/rss/parser.ts",
  "src/server/rss/refinement.ts",
  "src/server/rss/bilingual-backfill.ts",
  "src/server/rss/bilingual-core.ts",
  "src/server/rss/bilingual-gateway-port.ts",
  "src/server/rss/bilingual-migration.ts",
  "src/server/rss/bilingual-worker.ts",
  "src/server/rss/source-registry-migration.ts",
  "src/server/rss/source-registry.ts",
  "src/server/rss/transport.ts",
  "src/server/rss/types.ts",
  "src/server/runtime-config.ts",
  "src/server/security/cli.ts",
  "src/server/security/log.ts",
  "src/server/source-management/security.ts",
  "src/server/source-management/http.ts",
  "src/server/source-management/identity.ts",
  "src/server/source-management/raw-context.ts",
  "src/server/source-management/repository.ts",
  "src/server/source-management/runtime.ts",
  "src/server/source-management/server.ts",
  "src/server/source-management/types.ts",
  "src/server/vs1/no-egress.ts",
  "tsconfig.json"
] as const;

const ADMIN_RELEASE_LEGACY_BOOTSTRAP_PATH = "scripts/public-release-bootstrap.ts" as const;
export const ADMIN_RELEASE_RUNTIME_FILE_COUNT = 153 as const;
export const ADMIN_RELEASE_RUNTIME_PATH_SET_SHA256 = "cfcba2c33fffddc9c314754493a1ebfb3e489bdaefb0aaf8cd80960e6e5bf705" as const;
export const ADMIN_RELEASE_REQUIRED_RUNTIME_PATHS = Object.freeze([
  "migrations/rss-real/0005_second_rss_autosport.sql",
  "migrations/rss-real/0006_independent_rss_racefans_the_race.sql",
  "migrations/rss-real/0007_internal_operation_recovery_phase.sql",
  "migrations/rss-real/0008_x_manual_inbox.sql",
  "migrations/rss-real/0009_bilingual_refinement.sql",
  "migrations/rss-real/0010_source_registry.sql",
  "migrations/tweet-inbox/0001_tweet_inbox.sql",
  "scripts/quick-launch-auto-zero.ts",
  "scripts/quick-launch-enter-live.ts",
  "scripts/quick-launch-handoff-pool.ts",
  "scripts/quick-launch-processing-preflight.ts",
  "scripts/quick-launch-schedule-observer.ts",
  "src/server/internal-operation/authorizer.ts",
  "src/server/internal-operation/gateway.ts",
  "src/server/internal-operation/handoff-pool.ts",
  "src/server/internal-operation/mutation-port.ts",
  "src/server/internal-operation/quick-launch-control.ts",
  "src/server/internal-operation/quick-launch-processing.ts",
  "src/server/internal-operation/owner-supervisor.ts",
  "src/server/internal-operation/phase.ts",
  "src/server/internal-operation/recovery.ts",
  "src/server/internal-operation/release.ts",
  "src/server/internal-operation/trusted-local-bootstrap.ts",
  "src/server/quick-launch/auto-zero-vector.ts",
  "src/server/admin-service/deployment.ts",
  "src/server/admin-service/bilingual-admin.ts",
  "src/server/admin-service/bilingual-retry.ts",
  "src/server/admin-service/bilingual-projection-exporter.ts",
  "src/server/admin-service/bilingual-projection-writer.ts",
  "src/server/rss/bilingual-backfill.ts",
  "src/server/rss/bilingual-core.ts",
  "src/server/rss/bilingual-gateway-port.ts",
  "src/server/rss/bilingual-migration.ts",
  "src/server/rss/bilingual-worker.ts",
  "src/server/rss/source-registry-migration.ts",
  "src/server/rss/source-registry.ts",
  "src/server/public/bilingual-snapshot.ts",
  "src/server/tweet-inbox/repository.ts",
  "src/server/tweet-inbox/types.ts",
  "src/server/tweet-inbox/url.ts",
  "next-env.d.ts",
  "next.config.ts",
  "package-lock.json",
  "package.json",
  "tsconfig.json"
] as const);

function canonicalRuntimePathSet(paths: readonly string[]): string {
  return `${[...paths].sort().join("\n")}\n`;
}

export function adminReleaseRuntimePathSetSha256(paths: readonly string[] = ADMIN_RELEASE_RUNTIME_FILES): string {
  return sha256(canonicalRuntimePathSet(paths));
}

export function assertAdminReleaseRuntimePathContract(paths: readonly string[] = ADMIN_RELEASE_RUNTIME_FILES): void {
  const sorted = [...paths].sort();
  if (new Set(sorted).size !== sorted.length) {
    throw new ConfigError("RELEASE_IDENTITY", "Admin runtime path contract contains duplicate paths");
  }
  if (sorted.includes(ADMIN_RELEASE_LEGACY_BOOTSTRAP_PATH)) {
    throw new ConfigError("RELEASE_IDENTITY", "legacy public release bootstrap is excluded from the target Admin release closure");
  }
  const missingRequired = ADMIN_RELEASE_REQUIRED_RUNTIME_PATHS.filter((path) => !sorted.includes(path));
  if (missingRequired.length > 0) {
    throw new ConfigError("RELEASE_IDENTITY", `Admin runtime path contract omits critical release paths: ${missingRequired.join(",")}`);
  }
  if (
    sorted.length !== ADMIN_RELEASE_RUNTIME_FILE_COUNT ||
    adminReleaseRuntimePathSetSha256(sorted) !== ADMIN_RELEASE_RUNTIME_PATH_SET_SHA256
  ) {
    throw new ConfigError("RELEASE_IDENTITY", "Admin runtime path contract canonical identity changed");
  }
}

assertAdminReleaseRuntimePathContract();

export const ADMIN_RELEASE_PROJECT_ASSET_FILES = [
  "data/mvp-contract-v0.6-public-multimedia-pagination-synthetic/runtime-graph.public-multimedia-pagination-synthetic.json"
] as const;

export const ADMIN_RUNTIME_CLOSURE_SPEC = Object.freeze({
  entrypoints: Object.freeze([
    "scripts/admin-build-release-manifest.ts",
    "scripts/admin-release-build.ts",
    "scripts/admin-install-macos.ts",
    "scripts/admin-service.ts",
    "scripts/admin-verify-release-stage.ts",
    "scripts/install-macos-public-beta-core.ts",
    "scripts/projection-sender.ts",
    "scripts/public-projection-runtime.ts",
    "scripts/public-release-refresh.ts",
    "scripts/quick-launch-auto-zero.ts",
    "scripts/quick-launch-enter-live.ts",
    "scripts/quick-launch-handoff-pool.ts",
    "scripts/quick-launch-processing-preflight.ts",
    "scripts/quick-launch-schedule-observer.ts",
    "scripts/rss-collect-once.ts",
    "scripts/rss-refine-once.ts",
    "scripts/rss-scheduled-run.ts",
    "scripts/serve.ts",
    "src/app/api/health/route.ts",
    "src/app/api/public/feed/route.ts",
    "src/app/api/public/stories/[publicId]/route.ts",
    "src/app/layout.tsx",
    "src/app/page.tsx",
    "src/app/stories/[publicId]/not-found.tsx",
    "src/app/stories/[publicId]/page.tsx"
  ]),
  requiredFiles: Object.freeze([
    "src/server/rss/sources.ts",
    "src/modules/story/event-cluster.ts",
    "src/admin-ui/index.html",
    "src/admin-ui/app.js",
    "src/admin-ui/app.css",
    "src/admin-ui/x-management.html",
    "src/admin-ui/x-management.js",
    "src/server/internal-operation/recovery.ts",
    "src/server/internal-operation/quick-launch-control.ts",
    "src/server/internal-operation/quick-launch-processing.ts",
    "src/server/internal-operation/release.ts",
    "src/server/internal-operation/handoff-pool.ts",
    "src/server/internal-operation/trusted-local-bootstrap.ts",
    "src/server/tweet-inbox/repository.ts",
    "src/server/tweet-inbox/types.ts",
    "src/server/tweet-inbox/url.ts",
    "src/server/rss/bilingual-gateway-port.ts",
    "next.config.ts",
    "next-env.d.ts",
    "tsconfig.json",
    "package.json",
    "package-lock.json"
  ]),
  migrations: Object.freeze([
    "migrations/rss-real/0001_rss_real.sql",
    "migrations/rss-real/0002_admin_review_publish.sql",
    "migrations/rss-real/0003_projection_delivery_runtime.sql",
    "migrations/rss-real/0004_rss_media_and_chinese_refinement.sql",
    "migrations/rss-real/0005_second_rss_autosport.sql",
    "migrations/rss-real/0006_independent_rss_racefans_the_race.sql",
    "migrations/rss-real/0007_internal_operation_recovery_phase.sql",
    "migrations/rss-real/0008_x_manual_inbox.sql",
    "migrations/tweet-inbox/0001_tweet_inbox.sql"
  ]),
  staticAssets: Object.freeze([
    Object.freeze({ from: "src/admin-ui/index.html", request: "/admin/assets/app.css", target: "src/admin-ui/app.css" }),
    Object.freeze({ from: "src/admin-ui/index.html", request: "/admin/assets/app.js", target: "src/admin-ui/app.js" }),
    Object.freeze({ from: "src/admin-ui/x-management.html", request: "/admin/assets/app.css", target: "src/admin-ui/app.css" }),
    Object.freeze({ from: "src/admin-ui/x-management.html", request: "/admin/assets/x-management.js", target: "src/admin-ui/x-management.js" }),
    Object.freeze({ from: "src/admin-ui/x-management.html", request: "/admin/reviews", target: "src/admin-ui/index.html" }),
    Object.freeze({ from: "src/admin-ui/x-management.html", request: "/admin/sources", target: "src/admin-ui/x-management.html" }),
    Object.freeze({ from: "src/admin-ui/x-management.html", request: "/admin/x-submissions", target: "src/admin-ui/x-management.html" })
  ])
});

if (new Set(ADMIN_RELEASE_RUNTIME_FILES).size !== ADMIN_RELEASE_RUNTIME_FILES.length) {
  throw new ConfigError("RELEASE_IDENTITY", "runtime file closure contains duplicate paths");
}

export type AdminReleaseFileRecord = Readonly<{
  path: string;
  mode: number;
  size: number;
  sha256: string;
}>;

export type AdminBuildInputRecord = AdminReleaseFileRecord & Readonly<{ gitBlobSha1: string }>;
type FileRecord = AdminReleaseFileRecord;

export type AdminBuildCausalReceipt = Readonly<{
  schemaVersion: "f1plus1-admin-build-causal-receipt-v1";
  status: "success";
  command: "release:build-and-manifest";
  buildCommand: "next build";
  nextWasAbsentBeforeBuild: true;
  toolchain: Readonly<{
    nodePath: string;
    npmPath: string;
    nodeVersion: "24.18.0";
    nodeSha256: string;
    npmVersion: "11.16.0";
    npmLauncherSha256: string;
    pathDirectory: string;
    pathDirectoryRootSha256: string;
  }>;
  buildDependencyClosure: Readonly<{
    install: "npm-ci-clean-stage";
    packageLockSha256: string;
    fileCount: number;
    contentRootSha256: string;
  }>;
  environment: Readonly<{
    allowedEnvFiles: readonly string[];
    processEnvAllowlist: readonly string[];
    valuesSha256: Readonly<Record<string, string>>;
  }>;
  sealedBuildInputRootSha256: string;
}>;

export const ADMIN_RELEASE_NEXT_EXCLUDED_PATHS = [
  "cache/.previewinfo",
  "cache/.rscinfo",
  "cache/.tsbuildinfo",
  "diagnostics/build-diagnostics.json",
  "diagnostics/framework.json",
  "diagnostics/route-bundle-stats.json",
  "trace",
  "trace-build",
  "turbopack"
] as const;

export const ADMIN_RELEASE_NEXT_EXECUTABLE_FILES = [] as const;

type DependencyRecord = Readonly<{
  name: string;
  version: string;
  integrity: string;
  files: readonly AdminReleaseFileRecord[];
  contentRootSha256: string;
}>;

export type AdminReleaseManifest = Readonly<{
  schemaVersion: typeof ADMIN_RELEASE_MANIFEST_SCHEMA;
  gitCommit: string;
  gitTree: string;
  gitParent: string;
  runtimeFiles: readonly AdminReleaseFileRecord[];
  buildInputs: readonly AdminBuildInputRecord[];
  buildProvenance: AdminBuildCausalReceipt;
  nextBuild: Readonly<{
    files: readonly FileRecord[];
    excludedPaths: typeof ADMIN_RELEASE_NEXT_EXCLUDED_PATHS;
    totalBytes: number;
    contentRootSha256: string;
  }>;
  productionDependencies: Readonly<{
    roots: readonly ["@simplewebauthn/server", "fast-xml-parser", "next", "react", "react-dom", "zod"];
    platformPackages: readonly ["@next/swc-darwin-arm64", "@img/sharp-darwin-arm64", "@img/sharp-libvips-darwin-arm64"];
    packages: readonly DependencyRecord[];
    contentRootSha256: string;
  }>;
  node: Readonly<{
    targetPath: string;
    version: "24.18.0";
    sha256: string;
  }>;
  contentRootSha256: string;
  releaseRootSha256: string;
}>;

type LockPackage = Readonly<{
  version?: unknown;
  integrity?: unknown;
  dependencies?: Record<string, unknown>;
  optionalDependencies?: Record<string, unknown>;
}>;

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, entry]) => [key, canonicalValue(entry)])
    );
  }
  return value;
}

export function canonicalAdminReleaseJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function currentUid(): number {
  const uid = process.getuid?.();
  if (uid === undefined) throw new ConfigError("RELEASE_OWNER", "current uid is unavailable");
  return uid;
}

function fileRecord(root: string, path: string): FileRecord {
  const snapshot = readStableRegularFile(root, path);
  return Object.freeze({ path, mode: snapshot.mode, size: snapshot.size, sha256: sha256(snapshot.bytes) });
}

function runtimeFiles(appRoot: string): readonly FileRecord[] {
  assertAdminReleaseRuntimePathContract();
  const expected = deriveRuntimeLocalClosure(appRoot, ADMIN_RUNTIME_CLOSURE_SPEC);
  const paths = [...new Set([...ADMIN_RELEASE_RUNTIME_FILES, ...expected])].sort();
  assertRuntimeLocalClosure(appRoot, paths, ADMIN_RUNTIME_CLOSURE_SPEC);
  return Object.freeze(paths.map((path) => fileRecord(appRoot, path)));
}

function gitBlobAtCommit(projectRoot: string, gitCommit: string, path: string): string {
  const value = gitOutput(projectRoot, ["rev-parse", `${gitCommit}:${path}`]);
  if (!GIT_OBJECT_ID_PATTERN.test(value)) throw new ConfigError("RELEASE_GIT", `Git blob identity is invalid: ${path}`);
  return value;
}

function buildInputRecords(
  appRoot: string,
  projectRoot: string,
  gitCommit: string,
  runtime: readonly FileRecord[],
  buildClosure: AdminBuildClosure
): readonly AdminBuildInputRecord[] {
  const paths = [
    ...ADMIN_RELEASE_RUNTIME_FILES.map((path) => `app/${path}`),
    ...buildClosure.paths.map((path) => `app/${path}`),
    ...ADMIN_RELEASE_PROJECT_ASSET_FILES
  ].filter((value, index, all) => all.indexOf(value) === index).sort();
  const records = paths.map((path): AdminBuildInputRecord => {
    const snapshot = readStableRegularFile(projectRoot, path);
    const expectedBlob = gitBlobAtCommit(projectRoot, gitCommit, path);
    const actualBlob = gitBlobSha1(snapshot.bytes);
    if (actualBlob !== expectedBlob) throw new ConfigError("RELEASE_GIT", `${path} changed between Git validation and manifest read`);
    return Object.freeze({
      path,
      mode: snapshot.mode,
      size: snapshot.size,
      sha256: sha256(snapshot.bytes),
      gitBlobSha1: expectedBlob
    });
  });
  const byPath = new Map(records.map((entry) => [entry.path, entry]));
  for (const source of runtime) {
    const buildInput = byPath.get(`app/${source.path}`);
    if (!buildInput || buildInput.sha256 !== source.sha256 || buildInput.size !== source.size || buildInput.mode !== source.mode) {
      throw new ConfigError("RELEASE_GIT", `source file changed while release closure was being assembled: ${source.path}`);
    }
  }
  return Object.freeze(records);
}

function verifyRecordedFiles(root: string, records: readonly FileRecord[], prefix = ""): readonly FileRecord[] {
  const paths = records.map((entry) => entry.path);
  assertAdminReleaseRuntimePathContract(paths);
  if (new Set(paths).size !== paths.length || paths.some((path, index) => index > 0 && paths[index - 1] >= path)) {
    throw new ConfigError("RELEASE_MANIFEST", "recorded release file paths are not unique and sorted");
  }
  const recorded = new Set(paths);
  const missingRequired = ADMIN_RELEASE_RUNTIME_FILES.filter((path) => !recorded.has(path));
  if (missingRequired.length > 0) {
    throw new ConfigError("RELEASE_MANIFEST", `recorded Admin runtime closure omits required files: ${missingRequired.join(",")}`);
  }
  return Object.freeze(records.map((record) => {
    const path = prefix && record.path.startsWith(prefix) ? record.path.slice(prefix.length) : record.path;
    const actual = fileRecord(root, path);
    if (canonicalAdminReleaseJson(actual) !== canonicalAdminReleaseJson({
      path: record.path,
      mode: record.mode,
      size: record.size,
      sha256: record.sha256
    })) throw new ConfigError("RELEASE_MANIFEST", `recorded release file changed: ${record.path}`);
    return record;
  }));
}

function verifyBuildInputs(
  appRoot: string,
  records: readonly AdminBuildInputRecord[],
  runtime: readonly FileRecord[],
  buildClosure: AdminBuildClosure
): readonly AdminBuildInputRecord[] {
  const projectRoot = resolve(appRoot, "..");
  const expectedPaths = [
    ...ADMIN_RELEASE_RUNTIME_FILES.map((path) => `app/${path}`),
    ...buildClosure.paths.map((path) => `app/${path}`),
    ...ADMIN_RELEASE_PROJECT_ASSET_FILES
  ].filter((value, index, all) => all.indexOf(value) === index).sort();
  if (canonicalAdminReleaseJson(records.map((entry) => entry.path)) !== canonicalAdminReleaseJson(expectedPaths)) {
    throw new ConfigError("RELEASE_MANIFEST", "Admin build input path closure changed");
  }
  for (const record of records) {
    if (!GIT_OBJECT_ID_PATTERN.test(record.gitBlobSha1)) throw new ConfigError("RELEASE_MANIFEST", "Admin build input Git blob is invalid");
    const snapshot = readStableRegularFile(projectRoot, record.path);
    if (
      snapshot.mode !== record.mode || snapshot.size !== record.size ||
      sha256(snapshot.bytes) !== record.sha256 || gitBlobSha1(snapshot.bytes) !== record.gitBlobSha1
    ) throw new ConfigError("RELEASE_MANIFEST", `Admin build input changed: ${record.path}`);
  }
  return Object.freeze(records);
}

type NextBuildIdentity = Readonly<{
  absolute: string;
  path: string;
  kind: "directory" | "file";
  dev: number;
  ino: number;
  mode: number;
  excluded: boolean;
}>;

function inspectNextBuild(appRoot: string): readonly NextBuildIdentity[] {
  const root = resolve(appRoot, ".next");
  if (!existsSync(root)) throw new ConfigError("RELEASE_NEXT_BUILD", ".next build artifact is missing");
  const realRoot = realpathSync(root);
  if (realRoot !== root) throw new ConfigError("RELEASE_NEXT_BUILD", ".next root realpath changed");
  const excluded = new Set<string>(ADMIN_RELEASE_NEXT_EXCLUDED_PATHS);
  const entries: NextBuildIdentity[] = [];
  const walk = (absolute: string, path: string): void => {
    const stat = lstatSync(absolute);
    if (
      stat.isSymbolicLink() || stat.uid !== currentUid() || realpathSync(absolute) !== absolute ||
      relative(realRoot, absolute).split(sep).includes("..")
    ) throw new ConfigError("RELEASE_NEXT_BUILD", "Next build identity is not owner-controlled");
    const mode = stat.mode & 0o777;
    if (stat.isDirectory()) {
      if (mode !== 0o700 && mode !== 0o755) {
        throw new ConfigError("RELEASE_NEXT_BUILD", "Next build directory mode is not a permitted fresh-build mode");
      }
      entries.push(Object.freeze({ absolute, path, kind: "directory", dev: stat.dev, ino: stat.ino, mode, excluded: false }));
      for (const name of readdirSync(absolute).sort()) {
        walk(resolve(absolute, name), path === "" ? name : `${path}/${name}`);
      }
      return;
    }
    if (!stat.isFile() || stat.nlink !== 1) {
      throw new ConfigError("RELEASE_NEXT_BUILD", "Next build contains a special or multi-link file");
    }
    if (mode !== 0o600 && mode !== 0o644 && mode !== 0o664) {
      throw new ConfigError("RELEASE_NEXT_BUILD", "Next build file mode is not a permitted non-executable fresh-build mode");
    }
    entries.push(Object.freeze({
      absolute,
      path,
      kind: "file",
      dev: stat.dev,
      ino: stat.ino,
      mode,
      excluded: excluded.has(path)
    }));
  };
  walk(root, "");
  return Object.freeze(entries);
}

export function normalizeAdminNextBuildPermissions(appRoot: string): Readonly<{
  fileCount: number;
  directoryCount: number;
  excludedFileCount: number;
}> {
  const entries = inspectNextBuild(appRoot);
  for (const entry of entries) {
    if (entry.kind === "file" && entry.excluded) continue;
    const descriptor = openSync(entry.absolute, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    try {
      const before = fstatSync(descriptor);
      if (
        before.dev !== entry.dev || before.ino !== entry.ino || before.uid !== currentUid() ||
        (entry.kind === "file" && (!before.isFile() || before.nlink !== 1)) ||
        (entry.kind === "directory" && !before.isDirectory())
      ) throw new ConfigError("RELEASE_NEXT_BUILD", "Next build identity changed before permission normalization");
      const expectedMode = entry.kind === "directory" ? 0o755 : 0o644;
      fchmodSync(descriptor, expectedMode);
      if ((fstatSync(descriptor).mode & 0o777) !== expectedMode) {
        throw new ConfigError("RELEASE_NEXT_BUILD", "Next build permission normalization did not persist");
      }
    } finally {
      closeSync(descriptor);
    }
  }
  chmodSync(resolve(appRoot, ".next"), 0o755);
  return Object.freeze({
    fileCount: entries.filter((entry) => entry.kind === "file" && !entry.excluded).length,
    directoryCount: entries.filter((entry) => entry.kind === "directory").length,
    excludedFileCount: entries.filter((entry) => entry.kind === "file" && entry.excluded).length
  });
}

function nextBuild(appRoot: string): AdminReleaseManifest["nextBuild"] {
  const root = resolve(appRoot, ".next");
  const rootStat = lstatSync(root);
  if (
    !rootStat.isDirectory() || rootStat.isSymbolicLink() || rootStat.uid !== currentUid() ||
    (rootStat.mode & 0o777) !== 0o755 || realpathSync(root) !== root
  ) throw new ConfigError("RELEASE_NEXT_BUILD", ".next root is not owner-controlled");
  const excluded = new Set<string>(ADMIN_RELEASE_NEXT_EXCLUDED_PATHS);
  const files: FileRecord[] = [];
  const walk = (directory: string): void => {
    const directoryStat = lstatSync(directory);
    if (
      !directoryStat.isDirectory() || directoryStat.isSymbolicLink() || directoryStat.uid !== currentUid() ||
      (directoryStat.mode & 0o777) !== 0o755 || realpathSync(directory) !== directory
    ) throw new ConfigError("RELEASE_NEXT_BUILD", "Next build directory is not owner-controlled");
    for (const name of readdirSync(directory).sort()) {
      const absolute = resolve(directory, name);
      const path = relative(root, absolute).split(sep).join("/");
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new ConfigError("RELEASE_NEXT_BUILD", "Next build contains a symlink");
      if (stat.isDirectory()) walk(absolute);
      else if (stat.isFile()) {
        if (!excluded.has(path)) {
          const record = fileRecord(root, path);
          if (record.mode !== 0o644) {
            throw new ConfigError("RELEASE_NEXT_BUILD", "Next build file mode differs from the normalized non-executable mode");
          }
          files.push(record);
        }
      } else throw new ConfigError("RELEASE_NEXT_BUILD", "Next build contains a special file");
    }
  };
  walk(root);
  if (files.length === 0 || !files.some((entry) => entry.path === "BUILD_ID")) {
    throw new ConfigError("RELEASE_NEXT_BUILD", "Next build is empty or BUILD_ID is missing");
  }
  files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const frozen = Object.freeze(files);
  return Object.freeze({
    files: frozen,
    excludedPaths: ADMIN_RELEASE_NEXT_EXCLUDED_PATHS,
    totalBytes: frozen.reduce((total, entry) => total + entry.size, 0),
    contentRootSha256: sha256(canonicalAdminReleaseJson(frozen))
  });
}

function dependencyFiles(packageRoot: string): readonly FileRecord[] {
  const records: FileRecord[] = [];
  const walk = (directory: string): void => {
    const directoryStat = lstatSync(directory);
    if (
      !directoryStat.isDirectory() || directoryStat.isSymbolicLink() || directoryStat.uid !== currentUid() ||
      (directoryStat.mode & 0o022) !== 0 || realpathSync(directory) !== directory
    ) {
      throw new ConfigError("RELEASE_DEPENDENCY", "dependency directory is not owner-controlled");
    }
    for (const name of readdirSync(directory).sort()) {
      const absolute = resolve(directory, name);
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        const packageRelative = relative(packageRoot, absolute).split(sep).join("/");
        if (!packageRelative.startsWith("node_modules/.bin/")) {
          throw new ConfigError("RELEASE_DEPENDENCY", "dependency tree contains a symlink");
        }
        continue;
      }
      if (stat.isDirectory()) walk(absolute);
      else if (stat.isFile()) records.push(fileRecord(packageRoot, relative(packageRoot, absolute).split(sep).join("/")));
      else throw new ConfigError("RELEASE_DEPENDENCY", "dependency tree contains a special file");
    }
  };
  walk(packageRoot);
  records.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return Object.freeze(records);
}

/** Hash every byte in the clean npm install, including .bin executable
 * targets. This is intentionally broader than the runtime dependency list:
 * Next, React, TypeScript, SWC, platform packages and their transitive build
 * helpers all become causal inputs to the same-process build receipt. */
export function buildDependencyClosure(appRoot: string): Readonly<{
  fileCount: number;
  contentRootSha256: string;
}> {
  const root = resolve(appRoot, "node_modules");
  const rootStat = lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || realpathSync(root) !== root) {
    throw new ConfigError("RELEASE_DEPENDENCY", "npm ci did not produce an owner-controlled node_modules root");
  }
  const records: Array<Readonly<{ path: string; mode: number; size: number; sha256: string; symlinkTarget?: string }>> = [];
  // Vitest/Vite may materialize these process-local caches in the dependency
  // root after the causal build (for example, when release tests run before
  // stage verification). They are generated tooling state, not package
  // bytes, and must not make an otherwise identical release manifest drift.
  const generatedRootDirectories = new Set([".cache", ".turbo", ".vite", ".vite-temp"]);
  const walk = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      if (directory === root && generatedRootDirectories.has(name)) continue;
      const absolute = resolve(directory, name);
      const path = relative(root, absolute).split(sep).join("/");
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        const target = realpathSync(absolute);
        const targetStat = lstatSync(target);
        if (!targetStat.isFile()) throw new ConfigError("RELEASE_DEPENDENCY", `dependency symlink target is not a regular file: ${path}`);
        const bytes = readFileSync(target);
        records.push({ path, mode: targetStat.mode & 0o777, size: bytes.byteLength, sha256: sha256(bytes), symlinkTarget: relative(root, target).split(sep).join("/") });
      } else if (stat.isDirectory()) {
        walk(absolute);
      } else if (stat.isFile()) {
        const bytes = readFileSync(absolute);
        records.push({ path, mode: stat.mode & 0o777, size: bytes.byteLength, sha256: sha256(bytes) });
      } else {
        throw new ConfigError("RELEASE_DEPENDENCY", `dependency tree contains a special file: ${path}`);
      }
    }
  };
  walk(root);
  records.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return Object.freeze({ fileCount: records.length, contentRootSha256: sha256(canonicalAdminReleaseJson(records)) });
}

export function buildDependencyClosureRoot(appRoot: string): string {
  const packageLock = readFileSync(resolve(appRoot, "package-lock.json"));
  const closure = buildDependencyClosure(appRoot);
  return sha256(canonicalAdminReleaseJson({ packageLockSha256: sha256(packageLock), ...closure }));
}

function productionDependencies(appRoot: string): AdminReleaseManifest["productionDependencies"] {
  const lock = JSON.parse(readFileSync(resolve(appRoot, "package-lock.json"), "utf8")) as {
    packages?: Record<string, LockPackage>;
  };
  if (!lock.packages) throw new ConfigError("RELEASE_DEPENDENCY", "package-lock packages are missing");
  const names = new Set<string>();
  const visit = (name: string, includeOptional: boolean = false): void => {
    if (names.has(name)) return;
    const entry = lock.packages?.[`node_modules/${name}`];
    if (!entry || typeof entry.version !== "string" || typeof entry.integrity !== "string") {
      throw new ConfigError("RELEASE_DEPENDENCY", `package-lock identity is missing for ${name}`);
    }
    names.add(name);
    for (const dependency of Object.keys(entry.dependencies ?? {}).sort()) visit(dependency);
    if (includeOptional) {
      for (const dependency of Object.keys(entry.optionalDependencies ?? {}).sort()) {
        if ([
          "@next/swc-darwin-arm64",
          "sharp"
        ].includes(dependency)) visit(dependency, dependency === "sharp");
      }
    }
  };
  const roots = ["@simplewebauthn/server", "fast-xml-parser", "next", "react", "react-dom", "zod"] as const;
  for (const root of roots) visit(root, root === "next");
  for (const platformPackage of [
    "@next/swc-darwin-arm64",
    "@img/sharp-darwin-arm64",
    "@img/sharp-libvips-darwin-arm64"
  ] as const) visit(platformPackage, true);
  const packages = [...names].sort().map((name): DependencyRecord => {
    const entry = lock.packages?.[`node_modules/${name}`];
    if (!entry || typeof entry.version !== "string" || typeof entry.integrity !== "string") {
      throw new ConfigError("RELEASE_DEPENDENCY", `package-lock identity is missing for ${name}`);
    }
    const files = dependencyFiles(resolve(appRoot, "node_modules", name));
    return Object.freeze({
      name,
      version: entry.version,
      integrity: entry.integrity,
      files,
      contentRootSha256: sha256(canonicalAdminReleaseJson(files))
    });
  });
  const platformPackages = [
    "@next/swc-darwin-arm64",
    "@img/sharp-darwin-arm64",
    "@img/sharp-libvips-darwin-arm64"
  ] as const;
  for (const required of [...roots, ...platformPackages]) {
    if (!names.has(required)) throw new ConfigError("RELEASE_DEPENDENCY", `required runtime package is missing: ${required}`);
  }
  return Object.freeze({
    roots,
    platformPackages,
    packages: Object.freeze(packages),
    contentRootSha256: sha256(canonicalAdminReleaseJson(packages.map(({ files: _files, ...identity }) => identity)))
  });
}

function assertTargetNodePath(value: string): void {
  if (!isAbsolute(value) || value.includes("\0") || !value.endsWith("/.local/node-v24.18.0-darwin-arm64/bin/node")) {
    throw new ConfigError("RELEASE_NODE", "target Node path must be the fixed absolute Node 24 arm64 path");
  }
}

function assertLocalNodePath(value: string): string {
  const localNode = resolve(value);
  const localNodeStat = lstatSync(localNode);
  if (
    !localNodeStat.isFile() || localNodeStat.isSymbolicLink() || localNodeStat.nlink !== 1 ||
    localNodeStat.uid !== currentUid() || (localNodeStat.mode & 0o022) !== 0 ||
    realpathSync(localNode) !== localNode || localNode !== process.execPath
  ) {
    throw new ConfigError("RELEASE_NODE", "local Node bytes must come from the current fixed Node process");
  }
  return localNode;
}

function roots(input: Readonly<{
  gitCommit: string;
  gitTree: string;
  gitParent: string;
  runtimeFiles: readonly FileRecord[];
  buildInputs: readonly AdminBuildInputRecord[];
  buildProvenance: AdminBuildCausalReceipt;
  nextBuild: AdminReleaseManifest["nextBuild"];
  productionDependencies: AdminReleaseManifest["productionDependencies"];
  node: AdminReleaseManifest["node"];
}>): Readonly<{ contentRootSha256: string; releaseRootSha256: string }> {
  const contentRootSha256 = sha256(canonicalAdminReleaseJson({
    runtimeFiles: input.runtimeFiles,
    buildInputs: input.buildInputs,
    buildProvenance: input.buildProvenance,
    nextBuild: input.nextBuild,
    productionDependencies: input.productionDependencies,
    node: input.node
  }));
  return Object.freeze({
    contentRootSha256,
    releaseRootSha256: sha256(canonicalAdminReleaseJson({
      gitCommit: input.gitCommit,
      gitTree: input.gitTree,
      gitParent: input.gitParent,
      contentRootSha256
    }))
  });
}

function gitOutput(projectRoot: string, arguments_: readonly string[]): string {
  const result = spawnSync("/usr/bin/git", ["-C", projectRoot, ...arguments_], {
    encoding: "utf8",
    shell: false,
    maxBuffer: 1024 * 1024
  });
  if (result.error || result.status !== 0) throw new ConfigError("RELEASE_GIT", "Git release identity command failed");
  return result.stdout.trim();
}

function gitBytes(projectRoot: string, arguments_: readonly string[]): string {
  const result = spawnSync("/usr/bin/git", ["-C", projectRoot, ...arguments_], {
    encoding: "utf8",
    shell: false,
    maxBuffer: 1024 * 1024
  });
  if (result.error || result.status !== 0) throw new ConfigError("RELEASE_GIT", "Git release identity command failed");
  return result.stdout;
}

const REQUIRED_RELEASE_SCRIPTS = Object.freeze({
  "admin:build-release-manifest": "node --experimental-strip-types scripts/admin-build-release-manifest.ts",
  "admin:verify-release-stage": "node --experimental-strip-types scripts/admin-verify-release-stage.ts",
  "projection:sender-once": "node --experimental-transform-types scripts/projection-sender.ts",
  "projection:public-runtime": "node --experimental-strip-types scripts/public-projection-runtime.ts",
  "release:build-and-manifest": "node --experimental-strip-types scripts/admin-release-build.ts"
});

function assertRequiredReleaseScripts(appRoot: string): void {
  let packageJson: Record<string, unknown>;
  let lockRoot: Record<string, unknown>;
  try {
    packageJson = JSON.parse(readFileSync(resolve(appRoot, "package.json"), "utf8")) as Record<string, unknown>;
    const packageLock = JSON.parse(readFileSync(resolve(appRoot, "package-lock.json"), "utf8")) as {
      packages?: Record<string, Record<string, unknown>>;
    };
    lockRoot = packageLock.packages?.[""] ?? {};
  } catch {
    throw new ConfigError("RELEASE_GIT", "package.json or package-lock.json is invalid JSON");
  }
  const scripts = packageJson.scripts;
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) {
    throw new ConfigError("RELEASE_GIT", "package.json release scripts are missing");
  }
  for (const [name, command] of Object.entries(REQUIRED_RELEASE_SCRIPTS)) {
    if ((scripts as Record<string, unknown>)[name] !== command) {
      throw new ConfigError("RELEASE_GIT", `package.json release script is invalid: ${name}`);
    }
  }
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const) {
    if (canonicalAdminReleaseJson(packageJson[field] ?? {}) !== canonicalAdminReleaseJson(lockRoot[field] ?? {})) {
      throw new ConfigError("RELEASE_GIT", `package.json ${field} differs from the locked root`);
    }
  }
}

function assertRuntimeClosureDefinition(appRoot: string): void {
  assertAdminReleaseRuntimePathContract();
  const runtimePaths = new Set(ADMIN_RELEASE_RUNTIME_FILES);
  for (const relativePath of [
    "scripts/admin-build-release-manifest.ts",
    "scripts/admin-verify-release-stage.ts",
    "scripts/projection-sender.ts",
    "scripts/public-projection-runtime.ts"
  ] as const) {
    if (!runtimePaths.has(relativePath)) {
      throw new ConfigError("RELEASE_IDENTITY", `required release runtime file is absent: ${relativePath}`);
    }
    fileRecord(appRoot, relativePath);
  }
}

export function adminBuildInputRoot(records: readonly AdminBuildInputRecord[]): string {
  return sha256(canonicalAdminReleaseJson(records));
}

export function deriveAdminBuildInputRecords(
  appRoot: string,
  projectRoot: string,
  gitCommit: string
): readonly AdminBuildInputRecord[] {
  return buildInputRecords(appRoot, projectRoot, gitCommit, [], deriveAdminBuildClosure(appRoot));
}

function assertBuildProvenance(
  appRoot: string,
  buildInputs: readonly AdminBuildInputRecord[],
  buildProvenance: AdminBuildCausalReceipt,
  localNode: string
): void {
  const toolchain = buildProvenance && typeof buildProvenance === "object"
    ? buildProvenance.toolchain
    : undefined;
  const environment = buildProvenance && typeof buildProvenance === "object"
    ? buildProvenance.environment
    : undefined;
  const dependencyClosure = buildProvenance && typeof buildProvenance === "object"
    ? buildProvenance.buildDependencyClosure
    : undefined;
  if (
    !toolchain || typeof toolchain !== "object" ||
    !environment || typeof environment !== "object" ||
    !Array.isArray(environment.allowedEnvFiles) ||
    !Array.isArray(environment.processEnvAllowlist) ||
    !environment.valuesSha256 || typeof environment.valuesSha256 !== "object" || Array.isArray(environment.valuesSha256)
    || !dependencyClosure || typeof dependencyClosure !== "object"
  ) throw new ConfigError("RELEASE_NEXT_BUILD", "Admin manifest causal build receipt shape is invalid");
  if (
    buildProvenance.schemaVersion !== "f1plus1-admin-build-causal-receipt-v1" ||
    buildProvenance.status !== "success" ||
    buildProvenance.command !== "release:build-and-manifest" ||
    buildProvenance.buildCommand !== "next build" ||
    buildProvenance.nextWasAbsentBeforeBuild !== true ||
    toolchain.nodePath !== localNode ||
    toolchain.npmPath !== resolve(dirname(localNode), "npm") ||
    toolchain.nodeVersion !== "24.18.0" ||
    toolchain.nodeSha256 !== sha256(readFileSync(localNode)) ||
    toolchain.npmVersion !== "11.16.0" ||
    toolchain.npmLauncherSha256 !== sha256(readFileSync(resolve(dirname(localNode), "npm"))) ||
    toolchain.pathDirectory !== dirname(localNode) ||
    typeof toolchain.pathDirectoryRootSha256 !== "string" || !/^[0-9a-f]{64}$/.test(toolchain.pathDirectoryRootSha256)
  ) throw new ConfigError("RELEASE_NEXT_BUILD", "Admin manifest is missing the causal build receipt");
  const closure = deriveAdminBuildClosure(appRoot);
  const expectedValues = Object.fromEntries([
    ["NODE_ENV", sha256("production")],
    ["NEXT_TELEMETRY_DISABLED", sha256("1")],
    ["PATH", sha256(dirname(localNode))]
  ]);
  const actualValues = environment.valuesSha256 as Record<string, unknown>;
  if (
    JSON.stringify(environment.allowedEnvFiles) !== JSON.stringify(closure.allowedEnvFiles) ||
    JSON.stringify(environment.processEnvAllowlist) !== JSON.stringify(closure.processEnvAllowlist) ||
    canonicalAdminReleaseJson(actualValues) !== canonicalAdminReleaseJson(expectedValues) ||
    Object.values(actualValues).some((value) => typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) ||
    buildProvenance.sealedBuildInputRootSha256 !== adminBuildInputRoot(buildInputs) ||
    dependencyClosure.install !== "npm-ci-clean-stage" ||
    dependencyClosure.packageLockSha256 !== sha256(readFileSync(resolve(appRoot, "package-lock.json"))) ||
    dependencyClosure.contentRootSha256 !== buildDependencyClosure(appRoot).contentRootSha256 ||
    dependencyClosure.fileCount !== buildDependencyClosure(appRoot).fileCount
  ) {
    throw new ConfigError("RELEASE_NEXT_BUILD", "Admin causal build receipt does not match sealed build inputs or environment policy");
  }
}

export type AdminReleaseGitIdentity = Readonly<{ gitCommit: string; gitTree: string; gitParent: string }>;

const GIT_OBJECT_ID_PATTERN = /^[0-9a-f]{40}$/;

function currentSingleParentGitIdentity(projectRoot: string): AdminReleaseGitIdentity {
  const parts = gitOutput(projectRoot, ["rev-list", "--parents", "-n", "1", "HEAD"]).split(" ");
  if (parts.length !== 2 || parts.some((entry) => !GIT_OBJECT_ID_PATTERN.test(entry))) {
    throw new ConfigError("RELEASE_GIT", "Admin release HEAD must be one commit with exactly one parent");
  }
  const [gitCommit, gitParent] = parts;
  const gitTree = gitOutput(projectRoot, ["rev-parse", `${gitCommit}^{tree}`]);
  if (!GIT_OBJECT_ID_PATTERN.test(gitTree) || gitOutput(projectRoot, ["rev-parse", "--verify", "HEAD"]) !== gitCommit) {
    throw new ConfigError("RELEASE_GIT", "Admin release Git commit or tree identity is invalid");
  }
  return Object.freeze({ gitCommit, gitTree, gitParent });
}

function assertRuntimePathsTrackedAtHead(projectRoot: string, gitCommit: string, gitPaths: readonly string[]): void {
  gitOutput(projectRoot, ["ls-files", "--error-unmatch", "--", ...gitPaths]);
  for (const path of gitPaths) {
    const expectedBlob = gitOutput(projectRoot, ["rev-parse", `${gitCommit}:${path}`]);
    const actualBlob = gitOutput(projectRoot, ["hash-object", "--", path]);
    if (expectedBlob !== actualBlob) {
      throw new ConfigError("RELEASE_GIT", `${path} bytes differ from the current HEAD`);
    }
  }
}

export function resolveAdminReleaseGitIdentity(appRoot: string, projectRoot: string): AdminReleaseGitIdentity {
  const identity = currentSingleParentGitIdentity(projectRoot);
  if (
    realpathSync(resolve(projectRoot, "app")) !== realpathSync(appRoot)
  ) {
    throw new ConfigError("RELEASE_GIT", "Admin release app root differs from the Git project root");
  }
  assertRuntimeClosureDefinition(appRoot);
  assertRequiredReleaseScripts(appRoot);
  const expectedClosure = deriveRuntimeLocalClosure(appRoot, ADMIN_RUNTIME_CLOSURE_SPEC);
  const appPaths = [...new Set([...ADMIN_RELEASE_RUNTIME_FILES, ...expectedClosure])].sort();
  const buildClosure = deriveAdminBuildClosure(appRoot);
  const buildPaths = buildClosure.paths;
  assertRuntimeGitClosure(projectRoot, [...appPaths, ...buildPaths, ...ADMIN_RELEASE_PROJECT_ASSET_FILES]);
  const runtimePaths = [...new Set([...appPaths, ...buildPaths])].map((path) => `app/${path}`).concat(ADMIN_RELEASE_PROJECT_ASSET_FILES).sort();
  const runtimeStatus = gitBytes(projectRoot, [
    "status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...runtimePaths
  ]);
  if (runtimeStatus !== "") {
    throw new ConfigError("RELEASE_GIT", "Admin runtime closure must be clean at the current HEAD");
  }
  assertRuntimePathsTrackedAtHead(projectRoot, identity.gitCommit, runtimePaths);
  return identity;
}

export function buildAdminReleaseManifest(
  appRoot: string,
  projectRoot: string,
  targetNodePath: string,
  localNodePath: string = process.execPath,
  buildProvenance?: AdminBuildCausalReceipt
): AdminReleaseManifest {
  assertNodeVersion();
  assertTargetNodePath(targetNodePath);
  const gitIdentity = resolveAdminReleaseGitIdentity(appRoot, projectRoot);
  const localNode = assertLocalNodePath(localNodePath);
  if (!buildProvenance) throw new ConfigError("RELEASE_NEXT_BUILD", "Admin release manifest requires the same-process causal build receipt");
  const node = Object.freeze({
    targetPath: targetNodePath,
    version: "24.18.0" as const,
    sha256: sha256(readFileSync(localNode))
  });
  const runtime = runtimeFiles(appRoot);
  const buildClosure = deriveAdminBuildClosure(appRoot);
  const buildInputs = buildInputRecords(appRoot, projectRoot, gitIdentity.gitCommit, runtime, buildClosure);
  assertAdminBuildClosure(appRoot, buildClosure.paths);
  assertBuildProvenance(appRoot, buildInputs, buildProvenance, localNode);
  const next = nextBuild(appRoot);
  const dependencies = productionDependencies(appRoot);
  const finalIdentity = resolveAdminReleaseGitIdentity(appRoot, projectRoot);
  if (canonicalAdminReleaseJson(finalIdentity) !== canonicalAdminReleaseJson(gitIdentity)) {
    throw new ConfigError("RELEASE_GIT", "Git commit or tree changed while release manifest was being assembled");
  }
  if (
    canonicalAdminReleaseJson(nextBuild(appRoot)) !== canonicalAdminReleaseJson(next) ||
    canonicalAdminReleaseJson(productionDependencies(appRoot)) !== canonicalAdminReleaseJson(dependencies)
  ) throw new ConfigError("RELEASE_IDENTITY", "build or dependency bytes changed while release manifest was being assembled");
  const input = Object.freeze({
    ...gitIdentity,
    runtimeFiles: runtime,
    buildInputs,
    buildProvenance,
    nextBuild: next,
    productionDependencies: dependencies,
    node
  });
  return Object.freeze({ schemaVersion: ADMIN_RELEASE_MANIFEST_SCHEMA, ...input, ...roots(input) });
}

export function readVerifiedAdminReleaseManifest(
  appRoot: string,
  manifestPath: string,
  expectedManifestSha256: string | undefined,
  targetNodePath?: string,
  localNodePath: string = process.execPath
): AdminReleaseManifest {
  assertNodeVersion();
  const localNode = assertLocalNodePath(localNodePath);
  if (!expectedManifestSha256 || !/^[0-9a-f]{64}$/.test(expectedManifestSha256)) {
    throw new ConfigError("RELEASE_MANIFEST_ANCHOR", "ADMIN_EXPECTED_RELEASE_MANIFEST_SHA256 must be one lowercase SHA-256");
  }
  const absoluteManifestPath = resolve(manifestPath);
  const manifestSnapshot = readStableRegularFile(dirname(absoluteManifestPath), basename(absoluteManifestPath));
  if (manifestSnapshot.mode !== 0o600) {
    throw new ConfigError("RELEASE_MANIFEST", "Admin release manifest must be one owner-only single-link file");
  }
  const bytes = manifestSnapshot.bytes;
  if (sha256(bytes) !== expectedManifestSha256) {
    throw new ConfigError("RELEASE_MANIFEST_ANCHOR", "Admin release manifest bytes do not match the external expected SHA");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(bytes.toString("utf8")) as unknown; }
  catch { throw new ConfigError("RELEASE_MANIFEST", "Admin release manifest is invalid JSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ConfigError("RELEASE_MANIFEST", "Admin release manifest root is invalid");
  }
  const candidate = parsed as Partial<AdminReleaseManifest>;
  const node = candidate.node;
  const expectedTargetNodePath = targetNodePath ?? node?.targetPath;
  if (typeof expectedTargetNodePath !== "string") {
    throw new ConfigError("RELEASE_NODE", "anchored manifest target Node path is missing");
  }
  assertTargetNodePath(expectedTargetNodePath);
  if (
    candidate.schemaVersion !== ADMIN_RELEASE_MANIFEST_SCHEMA ||
    typeof candidate.gitCommit !== "string" || !GIT_OBJECT_ID_PATTERN.test(candidate.gitCommit) ||
    typeof candidate.gitTree !== "string" || !GIT_OBJECT_ID_PATTERN.test(candidate.gitTree) ||
    typeof candidate.gitParent !== "string" || !GIT_OBJECT_ID_PATTERN.test(candidate.gitParent) ||
    !Array.isArray(candidate.runtimeFiles) || !Array.isArray(candidate.buildInputs) ||
    !candidate.buildProvenance ||
    !node || node.targetPath !== expectedTargetNodePath || node.version !== "24.18.0" ||
    node.sha256 !== sha256(readFileSync(localNode))
  ) {
    throw new ConfigError("RELEASE_MANIFEST", "Admin release manifest Git or Node identity is invalid");
  }
  assertTargetNodePath(node.targetPath);
  const runtime = verifyRecordedFiles(appRoot, candidate.runtimeFiles);
  const buildClosure = deriveAdminBuildClosure(appRoot);
  const buildInputs = verifyBuildInputs(appRoot, candidate.buildInputs, runtime, buildClosure);
  assertBuildProvenance(appRoot, buildInputs, candidate.buildProvenance, localNode);
  const input = Object.freeze({
    gitCommit: candidate.gitCommit,
    gitTree: candidate.gitTree,
    gitParent: candidate.gitParent,
    runtimeFiles: runtime,
    buildInputs,
    buildProvenance: candidate.buildProvenance,
    nextBuild: nextBuild(appRoot),
    productionDependencies: productionDependencies(appRoot),
    node
  });
  const expected: AdminReleaseManifest = Object.freeze({
    schemaVersion: ADMIN_RELEASE_MANIFEST_SCHEMA,
    ...input,
    ...roots(input)
  });
  if (`${canonicalAdminReleaseJson(expected)}\n` !== bytes.toString("utf8")) {
    throw new ConfigError("RELEASE_MANIFEST", "Admin release content closure or deterministic roots changed");
  }
  return expected;
}
