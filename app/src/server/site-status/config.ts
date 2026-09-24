import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { isAbsolute, normalize } from "node:path";

import type { BackupSampleConfig, DatabaseSampleConfig } from "./types.ts";

export const PUBLIC_HEALTH_URL = "https://thick-canal-patrick-media.trycloudflare.com/api/health";
export const PUBLIC_PAGES_HOME_URL = "https://1404369477-blip.github.io/f1plus1/";
export const PUBLIC_PAGES_CURRENT_URL = `${PUBLIC_PAGES_HOME_URL}_public/current.json`;
export const PAGES_TIMEOUT_MS = 16_000;
export const HTTP_TIMEOUT_MS = 4_000;
export const PROCESS_TIMEOUT_MS = 1_500;
export const MAX_HTTP_BYTES = 65_536;
export const MAX_OUTPUT_BYTES = 131_072;
export const SAMPLE_TTL_MS = 60_000;

export type SiteStatusConfig = Readonly<{
  schemaVersion: 1;
  database: DatabaseSampleConfig;
  backup: BackupSampleConfig;
  publicTarget: Readonly<{ kind?: never; url: string; tunnelPid: number; tunnelStartedAt: string } | { kind: "github-pages"; url: string }>;
  storage: Readonly<{ path: string; warningAvailableBytes: number; failedAvailableBytes: number }>;
}>;

function reject(): never { throw new Error("STATUS_CONFIG_INVALID"); }

function record(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) reject();
  const item = value as Record<string, unknown>;
  if (required.some((key) => !Object.hasOwn(item, key)) || Object.keys(item).some((key) => !required.includes(key) && !optional.includes(key))) reject();
  return item;
}

function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) reject();
  return value;
}

function path(value: unknown): string {
  if (typeof value !== "string" || value.length > 4_096 || !isAbsolute(value) || normalize(value) !== value || [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) reject();
  return value;
}

function hash(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) reject();
  return value;
}

function iso(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) reject();
  return value;
}

export function validatePublicHealthUrl(value: unknown): string {
  // Raw equality also rejects userinfo, query/hash, alternative ports, URL normalisation and redirects to another host.
  if (value !== PUBLIC_HEALTH_URL) reject();
  return PUBLIC_HEALTH_URL;
}

export function parseSiteStatusConfig(value: unknown): SiteStatusConfig {
  const root = record(value, ["schemaVersion", "database", "backup", "publicTarget", "storage"]);
  if (root.schemaVersion !== 1) reject();
  const db = record(root.database, ["databasePath", "deploymentManifestPath", "expectedDeploymentManifestSha256", "expectedSchemaSha256", "expectedReleaseSha256", "expectedDatabaseIdentity"], ["busyTimeoutMs", "unknownBaseline"]);
  const identity = record(db.expectedDatabaseIdentity, ["device", "inode", "uid"]);
  const database: DatabaseSampleConfig = {
    databasePath: path(db.databasePath), deploymentManifestPath: path(db.deploymentManifestPath),
    expectedDeploymentManifestSha256: hash(db.expectedDeploymentManifestSha256), expectedSchemaSha256: hash(db.expectedSchemaSha256), expectedReleaseSha256: hash(db.expectedReleaseSha256),
    expectedDatabaseIdentity: { device: integer(identity.device), inode: integer(identity.inode, 1), uid: integer(identity.uid) },
    ...(db.busyTimeoutMs === undefined ? {} : { busyTimeoutMs: integer(db.busyTimeoutMs, 1, 1_000) }),
  };
  let unknownBaseline: DatabaseSampleConfig["unknownBaseline"];
  if (db.unknownBaseline !== undefined) {
    const baseline = record(db.unknownBaseline, ["observedAt", "operationIdSha256"]);
    if (!Array.isArray(baseline.operationIdSha256) || baseline.operationIdSha256.length > 10_000) reject();
    const hashes = baseline.operationIdSha256.map(hash);
    if (new Set(hashes).size !== hashes.length) reject();
    unknownBaseline = { observedAt: iso(baseline.observedAt), operationIdSha256: hashes };
  }
  const b = record(root.backup, ["backupRoot", "backupStateRoot", "offHostPublicKeyPath", "applicationDrillPublicKeyPath", "expectedOffHostPublicKeySha256", "expectedApplicationDrillPublicKeySha256"]);
  const backup: BackupSampleConfig = {
    backupRoot: path(b.backupRoot), backupStateRoot: path(b.backupStateRoot),
    offHostPublicKeyPath: path(b.offHostPublicKeyPath), applicationDrillPublicKeyPath: path(b.applicationDrillPublicKeyPath),
    expectedOffHostPublicKeySha256: hash(b.expectedOffHostPublicKeySha256), expectedApplicationDrillPublicKeySha256: hash(b.expectedApplicationDrillPublicKeySha256),
  };
  const targetKind = record(root.publicTarget, ["url"], ["kind", "tunnelPid", "tunnelStartedAt"]).kind;
  let publicTarget: SiteStatusConfig["publicTarget"];
  if (targetKind === "github-pages") {
    const target = record(root.publicTarget, ["kind", "url"]);
    if (target.url !== PUBLIC_PAGES_CURRENT_URL) reject();
    publicTarget = { kind: "github-pages", url: PUBLIC_PAGES_CURRENT_URL };
  } else {
    const target = record(root.publicTarget, ["url", "tunnelPid", "tunnelStartedAt"]);
    if (typeof target.tunnelStartedAt !== "string" || !/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ( [1-9]|[12]\d|3[01]) \d{2}:\d{2}:\d{2} 20\d{2}$/.test(target.tunnelStartedAt)) reject();
    publicTarget = { url: validatePublicHealthUrl(target.url), tunnelPid: integer(target.tunnelPid, 1, 2_147_483_647), tunnelStartedAt: target.tunnelStartedAt };
  }
  const storage = record(root.storage, ["path", "warningAvailableBytes", "failedAvailableBytes"]);
  const warningAvailableBytes = integer(storage.warningAvailableBytes, 1);
  const failedAvailableBytes = integer(storage.failedAvailableBytes, 1);
  if (failedAvailableBytes >= warningAvailableBytes) reject();
  return {
    schemaVersion: 1, database: { ...database, ...(unknownBaseline ? { unknownBaseline } : {}) }, backup,
    publicTarget,
    storage: { path: path(storage.path), warningAvailableBytes, failedAvailableBytes },
  };
}

export function readSiteStatusConfig(configPath: unknown): SiteStatusConfig {
  const configFile = path(configPath);
  if (realpathSync(configFile) !== configFile) reject();
  const fd = openSync(configFile, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 1_048_576 || (stat.mode & 0o022) !== 0 || stat.uid !== process.getuid?.()) reject();
    const bytes = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = readSync(fd, bytes, length, bytes.length - length, null);
      if (read === 0) break;
      length += read;
    }
    const after = fstatSync(fd), current = lstatSync(configFile);
    if (length !== stat.size || after.dev !== stat.dev || after.ino !== stat.ino || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs || after.mode !== stat.mode || after.uid !== stat.uid
      || current.dev !== after.dev || current.ino !== after.ino || current.isSymbolicLink() || realpathSync(configFile) !== configFile) reject();
    return parseSiteStatusConfig(JSON.parse(bytes.subarray(0, length).toString("utf8")));
  } finally { closeSync(fd); }
}
