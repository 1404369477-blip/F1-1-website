import { createHash } from "node:crypto";

import { ConfigError } from "../config/env.ts";
import { assertRuntimeLocalClosure, readStableRegularFile, type RuntimeClosureSpec } from "../release/local-closure.ts";

export const PUBLIC_RELEASE_MANIFEST_SCHEMA = "f1plus1-public-runtime-release-manifest-v1" as const;

export const PUBLIC_RELEASE_RUNTIME_FILES = [
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
  ".node-version",
  ".npmrc",
  ".nvmrc",
  "next-env.d.ts",
  "next.config.ts",
  "package-lock.json",
  "package.json",
  "scripts/install-macos-public-beta-core.ts",
  "scripts/install-macos-public-beta.ts",
  "scripts/public-projection-runtime.ts",
  "scripts/public-release-refresh.ts",
  "scripts/serve.ts",
  "src/app/api/health/route.ts",
  "src/app/api/public/feed/route.ts",
  "src/app/api/public/stories/[publicId]/route.ts",
  "src/app/layout.tsx",
  "src/app/page.tsx",
  "src/app/stories/[publicId]/not-found.tsx",
  "src/app/stories/[publicId]/page.tsx",
  "src/app/globals.css",
  "src/components/f1/f1-page-shell.tsx",
  "src/components/f1/story-parts.tsx",
  "src/components/f1/theme-preference.ts",
  "src/features/stories/editorial.ts",
  "src/features/stories/feed-experience.tsx",
  "src/features/stories/hash-params.ts",
  "src/features/stories/public-api.ts",
  "src/features/stories/story-detail-experience.tsx",
  "src/features/stories/timeline-search.ts",
  "src/modules/story/event-cluster.ts",
  "src/server/admin-service/quiesce-absence-guard.ts",
  "src/server/admin-service/release-manifest.ts",
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
  "src/server/internal-operation/authorizer.ts",
  "src/server/providers/fixture.ts",
  "src/server/providers/source-fixture.ts",
  "src/server/public/cursor.ts",
  "src/server/public/bilingual-snapshot.ts",
  "src/server/public/timeline.ts",
  "src/server/release/local-closure.ts",
  "src/server/release/build-closure.ts",
  "src/server/review-real/error.ts",
  "src/server/review-real/mapping.ts",
  "src/server/review-real/projection.ts",
  "src/server/review-real/receiver-http.ts",
  "src/server/review-real/schema.ts",
  "src/server/rss/sources.ts",
  "src/server/runtime-config.ts",
  "src/server/security/cli.ts",
  "src/server/security/log.ts",
  "src/server/source-management/http.ts",
  "src/server/source-management/identity.ts",
  "src/server/source-management/raw-context.ts",
  "src/server/source-management/repository.ts",
  "src/server/source-management/runtime.ts",
  "src/server/source-management/security.ts",
  "src/server/source-management/server.ts",
  "src/server/source-management/types.ts",
  "src/server/vs1/no-egress.ts",
  "src/server/public/deployment.ts",
  "src/server/public/error.ts",
  "src/server/public/http.ts",
  "src/server/public/release-manifest.ts",
  "src/server/public/repository.ts",
  "src/server/public/runtime.ts",
  "src/server/public/snapshot-adapter.ts",
  "src/server/public/types.ts",
  "tsconfig.json"
] as const;

const PUBLIC_RELEASE_LEGACY_BOOTSTRAP_PATH = "scripts/public-release-bootstrap.ts" as const;
export const PUBLIC_RELEASE_RUNTIME_FILE_COUNT = 89 as const;
export const PUBLIC_RELEASE_RUNTIME_PATH_SET_SHA256 = "b6f5a3885d9d0402f0634bd37ce9c3b4b51f25d33a7dc0c52f1768d7fac70665" as const;
export const PUBLIC_RELEASE_REQUIRED_RUNTIME_PATHS = Object.freeze([
  "migrations/rss-real/0005_second_rss_autosport.sql",
  "migrations/rss-real/0006_independent_rss_racefans_the_race.sql",
  "migrations/rss-real/0009_bilingual_refinement.sql",
  "migrations/rss-real/0010_source_registry.sql",
  "src/server/public/bilingual-snapshot.ts",
  "next-env.d.ts",
  "next.config.ts",
  "package-lock.json",
  "package.json",
  "tsconfig.json"
] as const);

function canonicalRuntimePathSet(paths: readonly string[]): string {
  return `${[...paths].sort().join("\n")}\n`;
}

export function publicReleaseRuntimePathSetSha256(paths: readonly string[] = PUBLIC_RELEASE_RUNTIME_FILES): string {
  return sha256(canonicalRuntimePathSet(paths));
}

export function assertPublicReleaseRuntimePathContract(paths: readonly string[] = PUBLIC_RELEASE_RUNTIME_FILES): void {
  const sorted = [...paths].sort();
  if (new Set(sorted).size !== sorted.length) {
    throw new ConfigError("RELEASE_CLOSURE", "public runtime path contract contains duplicate paths");
  }
  if (sorted.includes(PUBLIC_RELEASE_LEGACY_BOOTSTRAP_PATH)) {
    throw new ConfigError("RELEASE_CLOSURE", "legacy public release bootstrap is excluded from the target Public release closure");
  }
  const missingRequired = PUBLIC_RELEASE_REQUIRED_RUNTIME_PATHS.filter((path) => !sorted.includes(path));
  if (missingRequired.length > 0) {
    throw new ConfigError("RELEASE_CLOSURE", `public runtime path contract omits critical release paths: ${missingRequired.join(",")}`);
  }
  if (
    sorted.length !== PUBLIC_RELEASE_RUNTIME_FILE_COUNT ||
    publicReleaseRuntimePathSetSha256(sorted) !== PUBLIC_RELEASE_RUNTIME_PATH_SET_SHA256
  ) {
    throw new ConfigError("RELEASE_CLOSURE", "public runtime path contract canonical identity changed");
  }
}

assertPublicReleaseRuntimePathContract();

if (new Set(PUBLIC_RELEASE_RUNTIME_FILES).size !== PUBLIC_RELEASE_RUNTIME_FILES.length) {
  throw new ConfigError("RELEASE_CLOSURE", "public runtime closure contains duplicate paths");
}

export const PUBLIC_RUNTIME_CLOSURE_SPEC: RuntimeClosureSpec = Object.freeze({
  entrypoints: Object.freeze([
    "scripts/install-macos-public-beta.ts",
    "scripts/public-projection-runtime.ts",
    "scripts/public-release-refresh.ts",
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
    "src/server/public/deployment.ts",
    "src/server/public/http.ts",
    "src/server/public/bilingual-snapshot.ts",
    "src/server/public/runtime.ts",
    "src/server/public/snapshot-adapter.ts",
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
    "migrations/rss-real/0009_bilingual_refinement.sql",
    "migrations/rss-real/0010_source_registry.sql"
  ])
});

type PublicFileRecord = Readonly<{
  path: string;
  mode: number;
  size: number;
  sha256: string;
}>;

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fileRecord(appRoot: string, path: string): PublicFileRecord {
  const snapshot = readStableRegularFile(appRoot, path);
  return Object.freeze({ path, mode: snapshot.mode, size: snapshot.size, sha256: sha256(snapshot.bytes) });
}

function recordedPublicRuntimeClosure(appRoot: string): readonly PublicFileRecord[] {
  return Object.freeze([...PUBLIC_RELEASE_RUNTIME_FILES].sort().map((path) => fileRecord(appRoot, path)));
}

export function buildPublicRuntimeClosure(appRoot: string): readonly PublicFileRecord[] {
  assertPublicReleaseRuntimePathContract();
  const expected = assertRuntimeLocalClosure(appRoot, PUBLIC_RELEASE_RUNTIME_FILES, PUBLIC_RUNTIME_CLOSURE_SPEC);
  if (expected.some((path) => !PUBLIC_RELEASE_RUNTIME_FILES.includes(path as typeof PUBLIC_RELEASE_RUNTIME_FILES[number]))) {
    throw new ConfigError("RELEASE_CLOSURE", "public runtime closure omits an AST-derived file");
  }
  return recordedPublicRuntimeClosure(appRoot);
}

export function publicRuntimeClosureSha256(appRoot: string): string {
  return sha256(canonical(buildPublicRuntimeClosure(appRoot)));
}

export function assertPublicRuntimeClosure(appRoot: string, expectedSha256: string): void {
  assertPublicReleaseRuntimePathContract();
  if (!/^[0-9a-f]{64}$/.test(expectedSha256)) {
    throw new ConfigError("RELEASE_CLOSURE", "public runtime closure SHA must be lowercase SHA-256");
  }
  // Runtime verification deliberately hashes the build-time-approved explicit
  // closure without loading the TypeScript compiler (a development dependency).
  const actual = sha256(canonical(recordedPublicRuntimeClosure(appRoot)));
  if (actual !== expectedSha256) {
    throw new ConfigError("RELEASE_CLOSURE", "public runtime closure bytes changed");
  }
}
