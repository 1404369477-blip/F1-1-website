import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync
} from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const REQUIRED_NODE_VERSION = "24.18.0";

export const CANONICAL_ENV_KEYS = [
  "APP_ENV",
  "APP_PORT",
  "APP_BIND_HOST",
  "APP_PUBLIC_ORIGIN",
  "F1_DATA_PROFILE",
  "F1_DB_PATH",
  "F1_PUBLIC_READ_MODE",
  "F1_PUBLIC_DEPLOYMENT_MANIFEST_PATH",
  "F1_PUBLIC_PROJECTION_ROOT",
  "F1_PUBLIC_VERIFY_KEY_PATH",
  "F1_PUBLIC_SIGNING_KEY_ID",
  "SOURCE_CONFIG_PROVIDER",
  "SOURCE_FIXTURE_PATH",
  "ADAPTER_MODE",
  "SUMMARY_MODE",
  "MEDIA_MODE",
  "PUBLISH_MODE",
  "REAL_FEISHU_IO",
  "REAL_EXTERNAL_IO",
  "REAL_FORM_SUBMIT",
  "ADMIN_ACCESS_MODE",
  "LOG_LEVEL"
] as const;

export type CanonicalEnvKey = (typeof CANONICAL_ENV_KEYS)[number];
export type EnvRecord = Record<string, string | undefined>;

export type AppConfig = {
  appEnv: "local" | "test";
  port: number;
  bindHost: "127.0.0.1" | "::1";
  publicOrigin: string;
  dataProfile: "m3-shadow" | "public-synthetic" | "public-multimedia-synthetic" | "source-management-synthetic";
  dbPath: string;
  publicReadMode?: "public-multimedia-synthetic" | "public-real-snapshot";
  publicProjectionRoot?: string | null;
  publicVerifyKeyPath?: string | null;
  publicSigningKeyId?: string | null;
  sourceProvider: "fixture";
  fixturePath: string;
  adapterMode: "mock";
  summaryMode: "fixture";
  mediaMode: "fixture" | "none";
  publishMode: "manual_only";
  adminAccessMode: "local_dev_only";
  logLevel: "debug" | "info" | "warn" | "error";
  realFeishuIo: false;
  realExternalIo: false;
  realFormSubmit: false;
};

export type SecurePathInfo = {
  absolutePath: string;
  realPath: string;
  sha256: string;
  size: number;
  bytes: Buffer;
};

const DEFAULTS: Record<CanonicalEnvKey, string> = {
  APP_ENV: "local",
  APP_PORT: "3000",
  APP_BIND_HOST: "127.0.0.1",
  APP_PUBLIC_ORIGIN: "http://127.0.0.1:3000",
  F1_DATA_PROFILE: "m3-shadow",
  F1_DB_PATH: ".local/f1plus1.sqlite",
  F1_PUBLIC_READ_MODE: "public-multimedia-synthetic",
  F1_PUBLIC_DEPLOYMENT_MANIFEST_PATH: "",
  F1_PUBLIC_PROJECTION_ROOT: "",
  F1_PUBLIC_VERIFY_KEY_PATH: "",
  F1_PUBLIC_SIGNING_KEY_ID: "",
  SOURCE_CONFIG_PROVIDER: "fixture",
  SOURCE_FIXTURE_PATH: "../data/m3-base-shadow-import-v0/main-source-record-batch.json",
  ADAPTER_MODE: "mock",
  SUMMARY_MODE: "fixture",
  MEDIA_MODE: "fixture",
  PUBLISH_MODE: "manual_only",
  REAL_FEISHU_IO: "false",
  REAL_EXTERNAL_IO: "false",
  REAL_FORM_SUBMIT: "false",
  ADMIN_ACCESS_MODE: "local_dev_only",
  LOG_LEVEL: "info"
};

const CANONICAL_SET = new Set<string>(CANONICAL_ENV_KEYS);
const BLOCKED_NAMES = new Set([
  "NODE_OPTIONS",
  "NODE_PATH",
  "DATABASE_URL",
  "AUTO_PUBLISH",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY"
]);
const BLOCKED_NAME_PATTERN = /^(?:FEISHU|X|REDDIT|META)_|(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY|CLIENT_SECRET)$/i;
const APPLICATION_PREFIXES = [
  "APP_",
  "SOURCE_",
  "ADAPTER_",
  "SUMMARY_",
  "MEDIA_",
  "PUBLISH_",
  "REAL_",
  "ADMIN_",
  "F1_",
  "LOG_"
];
const MAX_FIXTURE_BYTES = 16 * 1024 * 1024;

export class ConfigError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "ConfigError";
    this.code = code;
  }
}

function isBlockedName(key: string): boolean {
  return BLOCKED_NAMES.has(key) || BLOCKED_NAME_PATTERN.test(key);
}

function looksApplicationScoped(key: string): boolean {
  return APPLICATION_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function rejectUnsafeKeys(env: EnvRecord, strict: boolean): void {
  for (const key of Object.keys(env)) {
    if (isBlockedName(key)) {
      throw new ConfigError("ENV_FORBIDDEN", `forbidden environment key ${key}`);
    }
    if (strict && !CANONICAL_SET.has(key)) {
      throw new ConfigError("ENV_UNKNOWN", `unknown environment key ${key}`);
    }
    if (!strict && looksApplicationScoped(key) && !CANONICAL_SET.has(key)) {
      throw new ConfigError("ENV_UNKNOWN", `unknown application environment key ${key}`);
    }
  }
}

export function parseEnvText(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [lineNumber, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) {
      throw new ConfigError("ENV_FILE", `invalid .env line ${lineNumber + 1}`);
    }
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (result[key] !== undefined) {
      throw new ConfigError("ENV_FILE", `duplicate key ${key}`);
    }
    result[key] = value;
  }
  return result;
}

export function mergeCanonicalEnv(...sources: EnvRecord[]): Record<CanonicalEnvKey, string> {
  const merged = { ...DEFAULTS } as Record<CanonicalEnvKey, string>;
  for (const source of sources) {
    rejectUnsafeKeys(source, false);
    for (const key of CANONICAL_ENV_KEYS) {
      const value = source[key];
      if (value !== undefined) merged[key] = value;
    }
  }
  return merged;
}

export function assertNodeVersion(nodeVersion: string = process.versions.node): void {
  if (nodeVersion !== REQUIRED_NODE_VERSION) {
    throw new ConfigError("NODE_VERSION", `expected Node ${REQUIRED_NODE_VERSION}, got ${nodeVersion}`);
  }
}

function parsePort(value: string): number {
  if (!/^[0-9]{1,5}$/.test(value)) throw new ConfigError("APP_PORT", "port must be decimal");
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new ConfigError("APP_PORT", "port must be between 1024 and 65535");
  }
  return port;
}

function parseFalse(value: string, key: string): false {
  if (value !== "false") throw new ConfigError("CAPABILITY_DISABLED", `${key} must be the literal false`);
  return false;
}

function assertDbPath(value: string): void {
  if (!value || value.includes("\0") || isAbsolute(value)) {
    throw new ConfigError("DB_PATH", "database path must be a relative local path");
  }
  const normalized = value.replaceAll("\\", "/");
  if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new ConfigError("DB_PATH", "database path may not escape app/.local");
  }
  if (!/^\.local\/[A-Za-z0-9][A-Za-z0-9._-]*\.sqlite$/.test(normalized)) {
    throw new ConfigError("DB_PATH", "database path must be one .local/<basename>.sqlite file without nested directories");
  }
}

type PublicRuntimeConfig = Readonly<{
  publicReadMode: "public-multimedia-synthetic" | "public-real-snapshot";
  publicProjectionRoot: string | null;
  publicVerifyKeyPath: string | null;
  publicSigningKeyId: string | null;
}>;

function parsePublicRuntime(values: Record<CanonicalEnvKey, string>): PublicRuntimeConfig {
  const mode = values.F1_PUBLIC_READ_MODE;
  if (mode === "public-multimedia-synthetic") {
    if (values.F1_PUBLIC_PROJECTION_ROOT || values.F1_PUBLIC_VERIFY_KEY_PATH || values.F1_PUBLIC_SIGNING_KEY_ID) {
      throw new ConfigError("PUBLIC_READ_MODE_MIX", "synthetic mode must not include real projection inputs");
    }
    return {
      publicReadMode: mode,
      publicProjectionRoot: null,
      publicVerifyKeyPath: null,
      publicSigningKeyId: null
    };
  }
  if (mode !== "public-real-snapshot") {
    throw new ConfigError("PUBLIC_READ_MODE", "unknown public read mode");
  }
  if (
    !isAbsolute(values.F1_PUBLIC_PROJECTION_ROOT) ||
    !isAbsolute(values.F1_PUBLIC_VERIFY_KEY_PATH) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(values.F1_PUBLIC_SIGNING_KEY_ID)
  ) {
    throw new ConfigError("PUBLIC_REAL_CONFIG", "real snapshot mode requires absolute public paths and one signing key id");
  }
  return {
    publicReadMode: mode,
    publicProjectionRoot: resolve(values.F1_PUBLIC_PROJECTION_ROOT),
    publicVerifyKeyPath: resolve(values.F1_PUBLIC_VERIFY_KEY_PATH),
    publicSigningKeyId: values.F1_PUBLIC_SIGNING_KEY_ID
  };
}

function assertOrigin(origin: string, host: string, port: number): void {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new ConfigError("APP_PUBLIC_ORIGIN", "origin is not a valid URL");
  }
  const expectedHost = host === "::1" ? "[::1]" : host;
  if (
    parsed.protocol !== "http:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    parsed.host !== `${expectedHost}:${port}`
  ) {
    throw new ConfigError("APP_PUBLIC_ORIGIN", "origin must exactly match the loopback bind and port");
  }
}

function ensureInsideRoot(target: string, root: string): boolean {
  const rel = relative(/* turbopackIgnore: true */ root, target);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function assertFixturePathChain(root: string, target: string): void {
  const currentUid = process.getuid?.();
  if (currentUid === undefined) throw new ConfigError("FIXTURE_OWNER", "current uid is unavailable");
  const rootStat = lstatSync(/* turbopackIgnore: true */ root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new ConfigError("FIXTURE_PATH", "fixture root must be a real directory");
  }
  if (rootStat.uid !== currentUid || (rootStat.mode & 0o022) !== 0) {
    throw new ConfigError("FIXTURE_OWNER", "fixture root must be private to the current local owner");
  }
  const relativePath = relative(/* turbopackIgnore: true */ root, target);
  if (!ensureInsideRoot(target, root)) throw new ConfigError("FIXTURE_PATH", "fixture path is outside its lexical root");
  let current = root;
  const parts = relativePath.split(sep).filter(Boolean);
  for (const [index, part] of parts.entries()) {
    current = resolve(/* turbopackIgnore: true */ current, part);
    const stat = lstatSync(/* turbopackIgnore: true */ current);
    if (stat.isSymbolicLink()) throw new ConfigError("FIXTURE_PATH", "fixture path contains a symlink component");
    if (stat.uid !== currentUid) throw new ConfigError("FIXTURE_OWNER", "fixture path must be owned by the current local user");
    if ((stat.mode & 0o022) !== 0) throw new ConfigError("FIXTURE_PATH", "fixture path must not be group/world writable");
    if (index < parts.length - 1 && !stat.isDirectory()) {
      throw new ConfigError("FIXTURE_PATH", "fixture path has a non-directory intermediate component");
    }
  }
}

export function validateFixturePath(
  fixturePath: string,
  appRoot: string,
  projectRoot: string
): SecurePathInfo {
  if (!fixturePath || isAbsolute(fixturePath) || fixturePath.includes("\0")) {
    throw new ConfigError("FIXTURE_PATH", "fixture path must be a relative path");
  }
  const absolutePath = resolve(/* turbopackIgnore: true */ appRoot, fixturePath);
  const dataRoot = resolve(/* turbopackIgnore: true */ projectRoot, "data");
  const appFixtureRoot = resolve(/* turbopackIgnore: true */ appRoot, "fixtures");
  const lexicalRoot = [dataRoot, appFixtureRoot].find((root) => ensureInsideRoot(absolutePath, root));
  if (!lexicalRoot) throw new ConfigError("FIXTURE_PATH", "fixture path is outside an allowed lexical root");
  try {
    assertFixturePathChain(lexicalRoot, absolutePath);
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError("FIXTURE_PATH", "fixture path chain cannot be inspected");
  }
  const allowedRoots = [dataRoot, appFixtureRoot].map((root) => {
    try {
      return realpathSync(/* turbopackIgnore: true */ root);
    } catch {
      return root;
    }
  });
  let lstat;
  try {
    lstat = lstatSync(/* turbopackIgnore: true */ absolutePath);
  } catch {
    throw new ConfigError("FIXTURE_PATH", "fixture file does not exist");
  }
  if (!lstat.isFile() || lstat.isSymbolicLink() || lstat.nlink !== 1) {
    throw new ConfigError("FIXTURE_PATH", "fixture must be a regular single-link file");
  }
  if ((lstat.mode & 0o022) !== 0) {
    throw new ConfigError("FIXTURE_PATH", "fixture must not be group/world writable");
  }
  const currentUid = process.getuid?.();
  if (currentUid === undefined || lstat.uid !== currentUid) {
    throw new ConfigError("FIXTURE_OWNER", "fixture must be owned by the current local user");
  }
  if (lstat.size > MAX_FIXTURE_BYTES) throw new ConfigError("FIXTURE_SIZE", "fixture exceeds the 16 MiB local limit");
  let realPath: string;
  try {
    realPath = realpathSync(/* turbopackIgnore: true */ absolutePath);
  } catch {
    throw new ConfigError("FIXTURE_PATH", "fixture realpath failed");
  }
  if (!allowedRoots.some((root) => ensureInsideRoot(realPath, root))) {
    throw new ConfigError("FIXTURE_PATH", "fixture realpath is outside an allowed root");
  }
  const noFollow = (fsConstants as { O_NOFOLLOW?: number }).O_NOFOLLOW;
  if (typeof noFollow !== "number") throw new ConfigError("FIXTURE_PATH", "O_NOFOLLOW is unavailable");
  const pathBefore = lstatSync(/* turbopackIgnore: true */ realPath);
  if (!pathBefore.isFile() || pathBefore.isSymbolicLink() || pathBefore.nlink !== 1 || (pathBefore.mode & 0o022) !== 0) {
    throw new ConfigError("FIXTURE_PATH", "fixture changed during validation");
  }
  let descriptor: number;
  try {
    descriptor = openSync(/* turbopackIgnore: true */ realPath, fsConstants.O_RDONLY | noFollow);
  } catch (error) {
    throw new ConfigError("FIXTURE_PATH", `fixture cannot be opened without following links: ${String(error)}`);
  }
  let bytes: Buffer;
  try {
    const descriptorBefore = fstatSync(descriptor);
    if (
      !descriptorBefore.isFile() ||
      descriptorBefore.nlink !== 1 ||
      (descriptorBefore.mode & 0o022) !== 0 ||
      descriptorBefore.uid !== currentUid ||
      descriptorBefore.size > MAX_FIXTURE_BYTES ||
      descriptorBefore.dev !== pathBefore.dev ||
      descriptorBefore.ino !== pathBefore.ino
    ) {
      throw new ConfigError("FIXTURE_PATH", "fixture identity changed before secure read");
    }
    bytes = Buffer.alloc(Number(descriptorBefore.size));
    let offset = 0;
    while (offset < bytes.byteLength) {
      const read = readSync(descriptor, bytes, offset, bytes.byteLength - offset, null);
      if (read === 0) throw new ConfigError("FIXTURE_PATH", "fixture was truncated during secure read");
      offset += read;
    }
    if (readSync(descriptor, Buffer.alloc(1), 0, 1, null) !== 0) {
      throw new ConfigError("FIXTURE_SIZE", "fixture grew during secure read");
    }
    const descriptorAfter = fstatSync(descriptor);
    const pathAfter = lstatSync(/* turbopackIgnore: true */ realPath);
    if (
      descriptorBefore.dev !== descriptorAfter.dev ||
      descriptorBefore.ino !== descriptorAfter.ino ||
      descriptorBefore.size !== descriptorAfter.size ||
      descriptorBefore.mtimeMs !== descriptorAfter.mtimeMs ||
      descriptorAfter.dev !== pathAfter.dev ||
      descriptorAfter.ino !== pathAfter.ino ||
      pathAfter.isSymbolicLink() ||
      pathAfter.nlink !== 1 ||
      pathAfter.uid !== currentUid ||
      (pathAfter.mode & 0o022) !== 0
    ) {
      throw new ConfigError("FIXTURE_PATH", "fixture changed during secure read");
    }
  } finally {
    closeSync(descriptor);
  }
  return {
    absolutePath,
    realPath,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.byteLength,
    bytes
  };
}

export function loadAppConfig(
  env: EnvRecord,
  options: {
    appRoot: string;
    projectRoot: string;
    nodeVersion?: string;
    strictKeys?: boolean;
  }
): AppConfig {
  rejectUnsafeKeys(env, options.strictKeys ?? true);
  assertNodeVersion(options.nodeVersion);
  const values = mergeCanonicalEnv(env);
  const appEnv = values.APP_ENV;
  if (appEnv !== "local" && appEnv !== "test") throw new ConfigError("APP_ENV", "only local or test is allowed");
  const port = parsePort(values.APP_PORT);
  const bindHost = values.APP_BIND_HOST;
  if (bindHost !== "127.0.0.1" && bindHost !== "::1") throw new ConfigError("APP_BIND_HOST", "only loopback is allowed");
  assertOrigin(values.APP_PUBLIC_ORIGIN, bindHost, port);
  assertDbPath(values.F1_DB_PATH);
  const dataProfile = values.F1_DATA_PROFILE;
  if (
    dataProfile !== "m3-shadow" &&
    dataProfile !== "public-synthetic" &&
    dataProfile !== "public-multimedia-synthetic" &&
    dataProfile !== "source-management-synthetic"
  ) {
    throw new ConfigError("DATA_PROFILE", "profile must be one accepted local profile");
  }
  const profileContract = dataProfile === "m3-shadow"
    ? {
        dbPath: ".local/f1plus1.sqlite",
        fixturePath: "../data/m3-base-shadow-import-v0/main-source-record-batch.json"
      }
    : dataProfile === "public-synthetic" ? {
        dbPath: ".local/f1plus1-public-synthetic.sqlite",
        fixturePath: "../data/mvp-contract-v0.4-public-synthetic/fixtures.public-synthetic.json"
      }
    : dataProfile === "public-multimedia-synthetic" ? {
        dbPath: ".local/f1plus1-public-multimedia-synthetic.sqlite",
        fixturePath: "../data/mvp-contract-v0.6-public-multimedia-pagination-synthetic/runtime-graph.public-multimedia-pagination-synthetic.json"
      }
    : {
        dbPath: ".local/f1plus1-source-management-synthetic.sqlite",
        fixturePath: "../data/m4-vs0-seed-enrichment-v0/source-seed-enriched.json"
      };
  if (values.F1_DB_PATH !== profileContract.dbPath) {
    throw new ConfigError("DB_PATH", "profile and database path must match one canonical profile");
  }
  if (values.SOURCE_CONFIG_PROVIDER !== "fixture") throw new ConfigError("PROVIDER_DISABLED", "only fixture provider is enabled");
  if (values.ADAPTER_MODE !== "mock") throw new ConfigError("ADAPTER_DISABLED", "only mock adapter is enabled");
  if (values.SUMMARY_MODE !== "fixture") throw new ConfigError("SUMMARY_DISABLED", "only fixture summary is enabled");
  if (values.MEDIA_MODE !== "fixture" && values.MEDIA_MODE !== "none") throw new ConfigError("MEDIA_DISABLED", "only fixture or none media is enabled");
  if (values.PUBLISH_MODE !== "manual_only") throw new ConfigError("PUBLISH_DISABLED", "only manual_only publication is enabled");
  if (values.ADMIN_ACCESS_MODE !== "local_dev_only") throw new ConfigError("ADMIN_DISABLED", "only local_dev_only admin mode is enabled");
  const logLevel = values.LOG_LEVEL;
  if (logLevel !== "debug" && logLevel !== "info" && logLevel !== "warn" && logLevel !== "error") {
    throw new ConfigError("LOG_LEVEL", "unknown log level");
  }
  if (values.SOURCE_FIXTURE_PATH !== profileContract.fixturePath) {
    throw new ConfigError("DATA_PROFILE_MIX", "profile and fixture path must match one canonical profile");
  }
  const publicRuntime = parsePublicRuntime(values);
  const fixturePath = publicRuntime.publicReadMode === "public-real-snapshot"
    ? values.SOURCE_FIXTURE_PATH
    : validateFixturePath(values.SOURCE_FIXTURE_PATH, options.appRoot, options.projectRoot).realPath;
  return {
    appEnv,
    port,
    bindHost,
    publicOrigin: values.APP_PUBLIC_ORIGIN,
    dataProfile,
    dbPath: values.F1_DB_PATH,
    ...publicRuntime,
    sourceProvider: "fixture",
    fixturePath,
    adapterMode: "mock",
    summaryMode: "fixture",
    mediaMode: values.MEDIA_MODE,
    publishMode: "manual_only",
    adminAccessMode: "local_dev_only",
    logLevel,
    realFeishuIo: parseFalse(values.REAL_FEISHU_IO, "REAL_FEISHU_IO"),
    realExternalIo: parseFalse(values.REAL_EXTERNAL_IO, "REAL_EXTERNAL_IO"),
    realFormSubmit: parseFalse(values.REAL_FORM_SUBMIT, "REAL_FORM_SUBMIT")
  };
}

export function verifyProcessEnvironment(env: EnvRecord = process.env): void {
  rejectUnsafeKeys(env, false);
  for (const key of Object.keys(env)) {
    if (looksApplicationScoped(key) && !CANONICAL_SET.has(key)) {
      throw new ConfigError("ENV_UNKNOWN", `unknown application environment key ${key}`);
    }
  }
}
