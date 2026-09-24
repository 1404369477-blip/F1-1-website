import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, lstatSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire, isBuiltin } from "node:module";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { deriveRuntimeLocalClosure, readStableRegularFile } from "../src/server/release/local-closure.ts";

export const BACKUP_RUNTIME_NODE = "v24.18.0";
export const BACKUP_RUNTIME_MANIFEST = "backup-runtime-manifest.json";
const entrypoints = ["scripts/backup-snapshot-once.ts", "scripts/backup-restore-drill.ts", "scripts/backup-recovery-point-register.ts", "scripts/backup-off-host-observe.ts"];
const requiredFiles = ["package.json", "package-lock.json", "tsconfig.json", "src/server/backup-snapshot/application-public-check.ts"];
const spec = { entrypoints, requiredFiles, migrations: [] };
const hashPattern = /^[a-f0-9]{64}$/;
type FileIdentity = { path: string; sha256: string; bytes: number };
export type BackupRuntimeManifest = {
  schemaVersion: "backup-runtime-v1";
  nodeVersion: string;
  entrypoints: string[];
  files: FileIdentity[];
  rootSha256: string;
};
function digest(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function fail(reason: string): never { throw new Error(`BACKUP_RUNTIME_${reason}`); }
function within(root: string, target: string): boolean {
  const delta = relative(root, target);
  return delta === "" || (!isAbsolute(delta) && delta !== ".." && !delta.startsWith(`..${sep}`));
}
function safePath(path: string): void {
  if (!path || path.includes("\\") || path.includes("\0") || isAbsolute(path) || path.split("/").some((part) => !part || part === "." || part === ".." || part.startsWith(".")) ||
    (path.includes("node_modules") && !path.startsWith("node_modules/zod/")) ||
    path.split("/").some((part) => /^(?:secrets?|credentials?)$/i.test(part)) ||
    /\.(?:sqlite(?:3)?|db|pem|key|p12|pfx|env)(?:-|$)/i.test(path)) fail("PATH_REJECTED");
}
function rootHash(files: FileIdentity[]): string {
  return digest(JSON.stringify({ schemaVersion: "backup-runtime-v1", nodeVersion: BACKUP_RUNTIME_NODE, entrypoints, files }));
}
function assertNode(): void {
  if (process.version !== BACKUP_RUNTIME_NODE) fail("NODE_VERSION_MISMATCH");
}
function assertDirectory(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o022) !== 0) fail("DIRECTORY_REJECTED");
}
function inventory(root: string, at = ""): string[] {
  assertDirectory(resolve(root, at));
  return readdirSync(resolve(root, at), { withFileTypes: true }).flatMap((entry) => {
    const path = at ? `${at}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) fail("LINK_REJECTED");
    if (entry.isDirectory()) return inventory(root, path);
    if (!entry.isFile()) fail("FILE_TYPE_REJECTED");
    return [path];
  }).sort();
}
function assertNoExternalImports(path: string, bytes: Buffer, dependencies: Set<string>): void {
  if (!/\.[cm]?[jt]sx?$/.test(path)) return;
  const ts = createRequire(import.meta.url)("typescript") as typeof import("typescript");
  const source = ts.createSourceFile(path, bytes.toString("utf8"), ts.ScriptTarget.Latest, true);
  const check = (request: string): void => {
    if (request === "zod") { dependencies.add("zod"); return; }
    if (!request.startsWith(".") && !isBuiltin(request)) fail("EXTERNAL_DEPENDENCY");
  };
  const visit = (node: import("typescript").Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier &&
      !(ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) && !(ts.isExportDeclaration(node) && node.isTypeOnly)) {
      if (!ts.isStringLiteral(node.moduleSpecifier)) fail("COMPUTED_IMPORT");
      check(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      const arg = node.arguments[0];
      if (!arg || (!ts.isStringLiteral(arg) && !ts.isNoSubstitutionTemplateLiteral(arg))) fail("COMPUTED_IMPORT");
      check(arg.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

/** Failure leaves only this invocation's new target incomplete, without a valid manifest. Never removes existing paths. */
export function prepareBackupRuntime(sourceInput: string, targetInput: string): BackupRuntimeManifest {
  assertNode();
  const source = realpathSync(sourceInput);
  assertDirectory(source);
  const target = resolve(realpathSync(dirname(resolve(targetInput))), resolve(targetInput).split(sep).at(-1)!);
  if (within(source, target) || within(target, source)) fail("SOURCE_TARGET_OVERLAP");
  // Non-recursive mkdir rejects existing files, directories, and dangling symlinks atomically.
  mkdirSync(target, { mode: 0o700 });
  const localPaths = [...deriveRuntimeLocalClosure(source, spec)];
  const dependencies = new Set<string>();
  const localSnapshots = new Map(localPaths.map((path) => [path, readStableRegularFile(source, path)]));
  for (const [path, snapshot] of localSnapshots) assertNoExternalImports(path, snapshot.bytes, dependencies);
  const dependencyPaths: string[] = [];
  if (dependencies.has("zod")) {
    const pkg = JSON.parse(readStableRegularFile(source, "node_modules/zod/package.json").bytes.toString("utf8"));
    const lock = JSON.parse(readStableRegularFile(source, "package-lock.json").bytes.toString("utf8"));
    if (pkg.name !== "zod" || pkg.version !== "4.4.3" || lock.packages?.["node_modules/zod"]?.version !== pkg.version || Object.keys(pkg.dependencies ?? {}).length) fail("DEPENDENCY_IDENTITY_MISMATCH");
    dependencyPaths.push(...inventory(resolve(source, "node_modules/zod")).map((path) => `node_modules/zod/${path}`));
  }
  const paths = [...localPaths, ...dependencyPaths].sort();
  const snapshots = paths.map((path) => {
    safePath(path);
    const snapshot = localSnapshots.get(path) ?? readStableRegularFile(source, path);
    return { path, snapshot };
  });
  const files = snapshots.map(({ path, snapshot }) => ({ path, sha256: digest(snapshot.bytes), bytes: snapshot.size }));
  for (const { path, snapshot } of snapshots) {
    const destination = resolve(target, path);
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    if (!within(target, realpathSync(dirname(destination)))) fail("TARGET_ESCAPE");
    writeFileSync(destination, snapshot.bytes, { flag: "wx", mode: 0o600 });
  }
  if (JSON.stringify(deriveRuntimeLocalClosure(source, spec)) !== JSON.stringify(localPaths)) fail("SOURCE_CLOSURE_CHANGED");
  if (dependencies.has("zod") && JSON.stringify(inventory(resolve(source, "node_modules/zod")).map((path) => `node_modules/zod/${path}`)) !== JSON.stringify(dependencyPaths)) fail("DEPENDENCY_CHANGED");
  for (const { path, snapshot } of snapshots) {
    const current = readStableRegularFile(source, path);
    if (current.dev !== snapshot.dev || current.ino !== snapshot.ino || !current.bytes.equals(snapshot.bytes)) fail("SOURCE_CHANGED");
  }
  const manifest: BackupRuntimeManifest = { schemaVersion: "backup-runtime-v1", nodeVersion: BACKUP_RUNTIME_NODE, entrypoints: [...entrypoints], files, rootSha256: rootHash(files) };
  for (const file of files) {
    const copied = readStableRegularFile(target, file.path);
    if (digest(copied.bytes) !== file.sha256 || copied.size !== file.bytes) fail("COPY_CHANGED");
  }
  if (JSON.stringify(inventory(target)) !== JSON.stringify(paths)) fail("TARGET_INVENTORY_MISMATCH");
  writeFileSync(resolve(target, BACKUP_RUNTIME_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return manifest;
}

/** Reads and hashes only; never imports or executes code from the candidate. Expected root must come from the preparation receipt. */
export function verifyBackupRuntime(targetInput: string, expectedRoot: string): BackupRuntimeManifest {
  assertNode();
  if (!hashPattern.test(expectedRoot)) fail("EXPECTED_ROOT_REQUIRED");
  assertDirectory(resolve(targetInput));
  const target = realpathSync(targetInput);
  const manifest = JSON.parse(readStableRegularFile(target, BACKUP_RUNTIME_MANIFEST).bytes.toString("utf8")) as BackupRuntimeManifest;
  if (manifest.schemaVersion !== "backup-runtime-v1" || manifest.nodeVersion !== BACKUP_RUNTIME_NODE ||
    JSON.stringify(manifest.entrypoints) !== JSON.stringify(entrypoints) || !Array.isArray(manifest.files) ||
    manifest.rootSha256 !== expectedRoot) fail("MANIFEST_INVALID");
  const paths: string[] = [];
  for (const file of manifest.files) {
    if (!file || typeof file.path !== "string" || typeof file.sha256 !== "string" || !hashPattern.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 0) fail("MANIFEST_INVALID");
    safePath(file.path);
    paths.push(file.path);
    const snapshot = readStableRegularFile(target, file.path);
    if (snapshot.size !== file.bytes || digest(snapshot.bytes) !== file.sha256) fail("FILE_IDENTITY_MISMATCH");
  }
  if (new Set(paths).size !== paths.length || JSON.stringify([...paths].sort()) !== JSON.stringify(paths) ||
    [...entrypoints, ...requiredFiles].some((path) => !paths.includes(path)) || rootHash(manifest.files) !== expectedRoot) fail("ROOT_MISMATCH");
  if (JSON.stringify(inventory(target)) !== JSON.stringify([...paths, BACKUP_RUNTIME_MANIFEST].sort())) fail("TARGET_INVENTORY_MISMATCH");
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [mode, first, second, ...extra] = process.argv.slice(2);
    if (!first || !second || extra.length || !["prepare", "verify"].includes(mode)) fail("USAGE_prepare_SOURCE_TARGET_or_verify_TARGET_EXPECTED_ROOT");
    const result = mode === "prepare" ? prepareBackupRuntime(first, second) : verifyBackupRuntime(first, second);
    process.stdout.write(`${JSON.stringify({ status: "verified", rootSha256: result.rootSha256, nodeVersion: result.nodeVersion, fileCount: result.files.length })}\n`);
  } catch (error) {
    const reason = error instanceof Error && error.message.startsWith("BACKUP_RUNTIME_") ? error.message : "BACKUP_RUNTIME_IO_OR_CLOSURE_FAILURE";
    process.stderr.write(`${JSON.stringify({ status: "failed", reason, incompleteTargetPolicy: "retain newly created target; do not execute without successful verification" })}\n`);
    process.exitCode = 1;
  }
}
