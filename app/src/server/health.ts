import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { CAPABILITY_REGISTRY } from "./config/capabilities.ts";
import type { AppConfig } from "./config/env.ts";
import { assertCapabilityRegistry } from "./config/registry.ts";
import {
  closeDatabase,
  openSafeDatabase,
  type DatabaseOptions,
  type SqliteDatabase
} from "./db/database.ts";
import { assertPublicSyntheticSeeded, assertSourceFixtureSeeded } from "./db/seed.ts";
import {
  assertPublicMultimediaSeeded,
  PUBLIC_MULTIMEDIA_GRAPH_ROOT_SHA256,
  PUBLIC_MULTIMEDIA_MIGRATION_SELECTOR_ROOT_SHA256,
  PUBLIC_MULTIMEDIA_PROFILE_LEDGER_ROOT_SHA256,
  PUBLIC_MULTIMEDIA_SCHEMA_FINGERPRINT_SHA256,
  withPublicMultimediaRuntimeDatabase
} from "./db/public-multimedia-synthetic.ts";
import {
  acquireSourceManagementProfileLock,
  assertSourceManagementReady,
  SOURCE_MANAGEMENT_SCHEMA_FINGERPRINT_SHA256,
  sourceManagementMigrationSelectorRoot
} from "./db/source-management-synthetic.ts";
import { SOURCE_PROJECTION_SHA256 } from "./providers/source-fixture.ts";
import {
  appRoot as defaultAppRoot,
  loadRuntimeConfig,
  projectRoot as defaultProjectRoot
} from "./runtime-config.ts";
import { PublicRealSnapshotReader } from "./public/snapshot-adapter.ts";

export type HealthDto = {
  scope: "local-only";
  status: "ready" | "not_ready";
  reasonCode: "ok" | "runtime_not_ready";
  dataGate: "accepted-local-fixture" | "accepted-public-synthetic" | "accepted-public-multimedia-synthetic" | "accepted-public-real-snapshot" | "accepted-source-management-synthetic" | "unverified";
  externalCalls: 0;
  capabilities: {
    sourceProvider: "fixture";
    adapter: "mock";
    summary: "fixture";
    media: "fixture_or_none";
    publication: "manual_only";
    network: "disabled";
    externalWrite: "disabled";
  };
  enforcement: {
    filesystemIsolation: "local_trusted_user";
    toctouProof: false;
    networkEnforcement: "pending";
  };
  runtime: {
    node: string;
    sqlite: string;
    migration: "source-fixture-0002" | "public-synthetic-0003" | "public-multimedia-synthetic-0003" | "public-real-snapshot-v1" | "source-management-synthetic-0003" | "unverified";
    seed: "59-source-disabled" | "12-public-synthetic" | "24-public-multimedia-pagination" | "signed-active-snapshot" | "59-baseline-readonly-local-overlay" | "unverified";
    contractVersion?: "public-read-v0.2" | "source-management-local-v0.3";
    fixtureGraphHash?: string;
    migrationSelectorRootSha256?: string;
    schemaFingerprintSha256?: string;
    profileLedgerRootSha256?: string;
  };
};

export type RuntimeReadinessOptions = {
  appRoot?: string;
  projectRoot?: string;
  config?: AppConfig;
  dbPath?: string;
  databaseOptions?: DatabaseOptions;
};

function resolveReadinessOptions(options: RuntimeReadinessOptions): {
  appRoot: string;
  projectRoot: string;
  config: AppConfig;
  dbPath: string;
  databaseOptions: DatabaseOptions;
} {
  const appRoot = resolve(options.appRoot ?? defaultAppRoot);
  const projectRoot = resolve(options.projectRoot ?? defaultProjectRoot);
  const config = options.config ?? loadRuntimeConfig();
  const dbPath = options.dbPath ?? config.dbPath;
  const databaseOptions = options.databaseOptions ?? { appRoot };
  return { appRoot, projectRoot, config, dbPath, databaseOptions };
}

export function assertRuntimeReady(options: RuntimeReadinessOptions = {}): {
  sqliteVersion: string;
  dataProfile: AppConfig["dataProfile"];
  publicReadMode: AppConfig["publicReadMode"];
} {
  const resolved = resolveReadinessOptions(options);
  assertCapabilityRegistry(resolved.config);
  if (resolved.config.publicReadMode === "public-real-snapshot") {
    if (!resolved.config.publicProjectionRoot || !resolved.config.publicVerifyKeyPath || !resolved.config.publicSigningKeyId) {
      throw new Error("HEALTH_PUBLIC_REAL_CONFIG_MISSING");
    }
    const reader = new PublicRealSnapshotReader({
      projectionRoot: resolved.config.publicProjectionRoot,
      signingKeyId: resolved.config.publicSigningKeyId,
      verifyKeyPath: resolved.config.publicVerifyKeyPath
    });
    reader.getFeed({ source: null, contentType: null, cursor: null });
    return {
      sqliteVersion: "not-applicable",
      dataProfile: resolved.config.dataProfile,
      publicReadMode: resolved.config.publicReadMode
    };
  }
  const absoluteDbPath = isAbsolute(resolved.dbPath)
    ? resolve(resolved.dbPath)
    : resolve(resolved.databaseOptions.appRoot, resolved.dbPath);
  if (!existsSync(absoluteDbPath)) throw new Error("HEALTH_DB_MISSING");
  if (resolved.config.dataProfile === "public-multimedia-synthetic" && !resolved.databaseOptions.allowTestRoot) {
    return withPublicMultimediaRuntimeDatabase(resolved.config, resolved.appRoot, resolved.projectRoot, (database) => {
      assertPublicMultimediaSeeded(database, resolved.config, resolved.projectRoot);
      const sqliteVersion = String((database.prepare("SELECT sqlite_version() AS version").get() as Record<string, unknown>).version);
      return { sqliteVersion, dataProfile: resolved.config.dataProfile, publicReadMode: resolved.config.publicReadMode };
    });
  }
  const sourceManagementLock = resolved.config.dataProfile === "source-management-synthetic" && !resolved.databaseOptions.allowTestRoot
    ? acquireSourceManagementProfileLock(resolved.appRoot)
    : undefined;
  let database: SqliteDatabase | undefined;
  try {
    database = openSafeDatabase(resolved.dbPath, resolved.databaseOptions);
    if (resolved.config.dataProfile === "m3-shadow") {
      assertSourceFixtureSeeded(database, resolved.config, resolved.appRoot, resolved.projectRoot);
    } else if (resolved.config.dataProfile === "public-synthetic") {
      assertPublicSyntheticSeeded(database, resolved.config, resolved.appRoot, resolved.projectRoot);
    } else if (resolved.config.dataProfile === "public-multimedia-synthetic") {
      assertPublicMultimediaSeeded(database, resolved.config, resolved.projectRoot);
    } else {
      assertSourceManagementReady(database, resolved.config, resolved.appRoot, resolved.projectRoot);
    }
    const sqliteVersion = String((database.prepare("SELECT sqlite_version() AS version").get() as Record<string, unknown>).version);
    return { sqliteVersion, dataProfile: resolved.config.dataProfile, publicReadMode: resolved.config.publicReadMode };
  } finally {
    if (database) closeDatabase(database);
    sourceManagementLock?.release();
  }
}

function dto(
  status: "ready" | "not_ready",
  sqliteVersion = "unverified",
  dataProfile?: AppConfig["dataProfile"],
  publicReadMode?: AppConfig["publicReadMode"]
): HealthDto {
  const ready = status === "ready";
  const publicReal = ready && publicReadMode === "public-real-snapshot";
  const publicSynthetic = ready && dataProfile === "public-synthetic";
  const publicMultimedia = ready && dataProfile === "public-multimedia-synthetic";
  const sourceManagement = ready && dataProfile === "source-management-synthetic";
  return {
    scope: "local-only",
    status,
    reasonCode: ready ? "ok" : "runtime_not_ready",
    dataGate: ready
      ? publicReal ? "accepted-public-real-snapshot" : sourceManagement ? "accepted-source-management-synthetic" : publicMultimedia ? "accepted-public-multimedia-synthetic" : publicSynthetic ? "accepted-public-synthetic" : "accepted-local-fixture"
      : "unverified",
    externalCalls: 0,
    capabilities: {
      sourceProvider: CAPABILITY_REGISTRY.sourceProvider,
      adapter: CAPABILITY_REGISTRY.adapter,
      summary: CAPABILITY_REGISTRY.summary,
      media: CAPABILITY_REGISTRY.media,
      publication: CAPABILITY_REGISTRY.publication,
      network: CAPABILITY_REGISTRY.network,
      externalWrite: CAPABILITY_REGISTRY.externalWrite
    },
    enforcement: {
      filesystemIsolation: "local_trusted_user",
      toctouProof: false,
      networkEnforcement: "pending"
    },
    runtime: {
      node: process.versions.node,
      sqlite: sqliteVersion,
      migration: ready
        ? publicReal ? "public-real-snapshot-v1" : sourceManagement ? "source-management-synthetic-0003" : publicMultimedia ? "public-multimedia-synthetic-0003" : publicSynthetic ? "public-synthetic-0003" : "source-fixture-0002"
        : "unverified",
      seed: ready
        ? publicReal ? "signed-active-snapshot" : sourceManagement ? "59-baseline-readonly-local-overlay" : publicMultimedia ? "24-public-multimedia-pagination" : publicSynthetic ? "12-public-synthetic" : "59-source-disabled"
        : "unverified",
      ...(publicReal ? {} : sourceManagement ? {
        contractVersion: "source-management-local-v0.3" as const,
        fixtureGraphHash: SOURCE_PROJECTION_SHA256,
        migrationSelectorRootSha256: sourceManagementMigrationSelectorRoot(defaultAppRoot),
        schemaFingerprintSha256: SOURCE_MANAGEMENT_SCHEMA_FINGERPRINT_SHA256
      } : publicMultimedia ? {
        contractVersion: "public-read-v0.2" as const,
        fixtureGraphHash: PUBLIC_MULTIMEDIA_GRAPH_ROOT_SHA256,
        migrationSelectorRootSha256: PUBLIC_MULTIMEDIA_MIGRATION_SELECTOR_ROOT_SHA256,
        schemaFingerprintSha256: PUBLIC_MULTIMEDIA_SCHEMA_FINGERPRINT_SHA256,
        profileLedgerRootSha256: PUBLIC_MULTIMEDIA_PROFILE_LEDGER_ROOT_SHA256
      } : {})
    }
  };
}

export function getHealthDto(options: RuntimeReadinessOptions = {}): HealthDto {
  try {
    const runtime = assertRuntimeReady(options);
    return dto("ready", runtime.sqliteVersion, runtime.dataProfile, runtime.publicReadMode);
  } catch {
    return dto("not_ready");
  }
}
