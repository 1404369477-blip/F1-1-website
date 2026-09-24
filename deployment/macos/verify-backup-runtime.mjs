import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
// Installed alongside the launch wrapper, outside the runtime being checked.
const [rootInput, expected] = process.argv.slice(2);
function fail() { throw new Error("BACKUP_RUNTIME_IDENTITY_REJECTED"); }
function hash(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function owned(path, directory = false) {
  const s = lstatSync(path);
  if (s.isSymbolicLink() || s.uid !== process.getuid() || (s.mode & 0o022) || (directory ? !s.isDirectory() : !s.isFile())) fail();
}
try {
  if (process.version !== "v24.18.0" || !rootInput || !/^[a-f0-9]{64}$/.test(expected ?? "")) fail();
  const root = resolve(rootInput); owned(root, true);
  if (realpathSync(root) !== root) fail();
  const manifestPath = resolve(root, "backup-runtime-manifest.json"); owned(manifestPath);
  const m = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (m.schemaVersion !== "backup-runtime-v1" || m.nodeVersion !== process.version || m.rootSha256 !== expected || !Array.isArray(m.files) || !Array.isArray(m.entrypoints)) fail();
  if (hash(JSON.stringify({ schemaVersion: m.schemaVersion, nodeVersion: m.nodeVersion, entrypoints: m.entrypoints, files: m.files })) !== expected) fail();
  const paths = new Set();
  for (const f of m.files) {
    if (!f || typeof f.path !== "string" || isAbsolute(f.path) || f.path.split("/").some(p => !p || p === "." || p === "..") || paths.has(f.path)) fail();
    const path = resolve(root, f.path); owned(path);
    if (relative(root, realpathSync(path)) !== f.path) fail();
    const before = lstatSync(path), bytes = readFileSync(path), after = lstatSync(path);
    if (bytes.length !== f.bytes || hash(bytes) !== f.sha256 || before.ino !== after.ino || before.dev !== after.dev || before.size !== after.size || before.mtimeMs !== after.mtimeMs) fail();
    paths.add(f.path);
  }
  const inventory = (at) => readdirSync(at, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(at, entry.name); owned(path, entry.isDirectory());
    return entry.isDirectory() ? inventory(path) : [relative(root, path)];
  });
  if (JSON.stringify(inventory(root).sort()) !== JSON.stringify([...paths, "backup-runtime-manifest.json"].sort())) fail();
} catch {
  process.stderr.write("BACKUP_RUNTIME_IDENTITY_REJECTED\n"); process.exitCode = 1;
}
