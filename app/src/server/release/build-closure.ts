import { existsSync, lstatSync, readdirSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

import { ConfigError } from "../config/env.ts";

/**
 * Files that Next may read without appearing in an application import graph.
 * Keep this list deliberately boring: a release build must have an explicit
 * identity for every framework/configuration input.
 */
export const ADMIN_BUILD_ROOT_INPUTS = Object.freeze([
  ".env.example",
  ".npmrc",
  ".node-version",
  ".nvmrc",
  "next-env.d.ts",
  "next.config.ts",
  "next.config.js",
  "next.config.mjs",
  "next.config.cjs",
  "postcss.config.js",
  "postcss.config.mjs",
  "postcss.config.cjs",
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "tsconfig.json",
  "package.json",
  "package-lock.json"
] as const);

export const ADMIN_BUILD_ENV_FILE_ALLOWLIST = Object.freeze([".env.example"] as const);

export const ADMIN_BUILD_PROCESS_ENV_ALLOWLIST = Object.freeze([
  "NODE_ENV",
  "NEXT_TELEMETRY_DISABLED",
  "PATH"
] as const);

export type AdminBuildClosure = Readonly<{
  paths: readonly string[];
  allowedEnvFiles: readonly string[];
  processEnvAllowlist: readonly string[];
}>;

function relativePath(root: string, absolute: string): string {
  return relative(root, absolute).split(sep).join("/");
}

function assertNoSymlink(absolute: string, path: string): void {
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink()) {
    throw new ConfigError("RELEASE_BUILD_INPUT", `Next build input cannot be a symlink: ${path}`);
  }
}

function walkRegularFiles(root: string, directory: string, output: string[]): void {
  const directoryPath = resolve(root, directory);
  assertNoSymlink(directoryPath, directory || ".");
  const stat = lstatSync(directoryPath);
  if (!stat.isDirectory()) throw new ConfigError("RELEASE_BUILD_INPUT", `build input directory is not a directory: ${directory}`);
  for (const name of readdirSync(directoryPath).sort()) {
    const child = directory ? `${directory}/${name}` : name;
    const childPath = resolve(root, child);
    assertNoSymlink(childPath, child);
    const childStat = lstatSync(childPath);
    if (childStat.isDirectory()) walkRegularFiles(root, child, output);
    else if (childStat.isFile()) output.push(child);
    else throw new ConfigError("RELEASE_BUILD_INPUT", `build input is not a regular file: ${child}`);
  }
}

function rootConfigFiles(root: string): string[] {
  const files: string[] = [];
  for (const path of ADMIN_BUILD_ROOT_INPUTS) {
    const absolute = resolve(root, path);
    if (existsSync(absolute)) {
      assertNoSymlink(absolute, path);
      if (!lstatSync(absolute).isFile()) throw new ConfigError("RELEASE_BUILD_INPUT", `build input is not a regular file: ${path}`);
      files.push(path);
    }
  }
  // Root-level convention entrypoints are valid Next inputs even when the
  // project uses the src/ layout. Include every supported extension explicitly.
  for (const name of readdirSync(root).sort()) {
    if (!/^(?:middleware|proxy|instrumentation)\.(?:[cm]?js|[cm]?ts|tsx)$/.test(name)) continue;
    assertNoSymlink(resolve(root, name), name);
    if (!lstatSync(resolve(root, name)).isFile()) throw new ConfigError("RELEASE_BUILD_INPUT", `framework entrypoint is not a file: ${name}`);
    files.push(name);
  }
  return files;
}

function envFiles(root: string): readonly string[] {
  const present = readdirSync(root).filter((name) => name === ".env" || name.startsWith(".env.")).sort();
  for (const name of present) {
    if (!ADMIN_BUILD_ENV_FILE_ALLOWLIST.includes(name as (typeof ADMIN_BUILD_ENV_FILE_ALLOWLIST)[number])) {
      throw new ConfigError("RELEASE_ENV", `unapproved Next environment file is present: ${name}`);
    }
    assertNoSymlink(resolve(root, name), name);
    if (!lstatSync(resolve(root, name)).isFile()) throw new ConfigError("RELEASE_ENV", `allowed environment input is not a file: ${name}`);
  }
  return Object.freeze(present);
}

/**
 * Derive build inputs independently of the runtime import closure. This is
 * intentionally conservative: all src/ and public/ files are included so
 * type-only imports, CSS, HTML and framework convention discovery cannot be
 * omitted by a runtime AST graph.
 */
export function deriveAdminBuildClosure(appRoot: string): AdminBuildClosure {
  const root = resolve(appRoot);
  const paths = [...rootConfigFiles(root)];
  const presentEnvFiles = envFiles(root);
  paths.push(...presentEnvFiles);
  // Support both src/ and root-layout Next projects. In the current app the
  // root-layout directories are absent; if introduced later they must still
  // be sealed rather than silently falling outside the build closure.
  for (const directory of ["src", "app", "pages", "public"] as const) {
    if (existsSync(resolve(root, directory))) walkRegularFiles(root, directory, paths);
  }
  const unique = [...new Set(paths)].sort();
  for (const path of unique) {
    if (path.includes("node_modules/") || path.startsWith(".next/")) {
      throw new ConfigError("RELEASE_BUILD_INPUT", `generated/dependency path entered build closure: ${path}`);
    }
  }
  return Object.freeze({
    paths: Object.freeze(unique),
    allowedEnvFiles: ADMIN_BUILD_ENV_FILE_ALLOWLIST,
    processEnvAllowlist: ADMIN_BUILD_PROCESS_ENV_ALLOWLIST
  });
}

export function assertAdminBuildClosure(appRoot: string, declaredPaths: readonly string[]): AdminBuildClosure {
  const expected = deriveAdminBuildClosure(appRoot);
  const declared = [...declaredPaths].sort();
  if (JSON.stringify(declared) !== JSON.stringify(expected.paths)) {
    const missing = expected.paths.filter((path) => !declared.includes(path));
    const extra = declared.filter((path) => !expected.paths.includes(path));
    throw new ConfigError("RELEASE_BUILD_INPUT", `Admin build input closure differs (missing=${missing.join(",")}; extra=${extra.join(",")})`);
  }
  return expected;
}
