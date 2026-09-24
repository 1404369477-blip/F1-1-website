import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { backupLayout, runSnapshotOnce, type SnapshotInput, type SnapshotManifest } from "../../server/backup-snapshot/core.ts";

export function cacheFixture() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "backup-cache-test-"));
  const sourceDbPath = join(root, "source.sqlite"), projectionRoot = join(root, "projection"), outputDir = join(root, "backup");
  mkdirSync(join(projectionRoot, "generations"), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(sourceDbPath);
  db.exec("CREATE TABLE item(id INTEGER PRIMARY KEY, note TEXT); INSERT INTO item VALUES(1,'original'); PRAGMA user_version=10;");
  db.close();
  const data = Buffer.from('{"value":"projection"}'), hash = createHash("sha256").update(data).digest("hex");
  writeFileSync(join(projectionRoot, "generations", `${hash}.json`), data, { mode: 0o600 });
  writeFileSync(join(projectionRoot, "active.json"), JSON.stringify({ snapshotManifestHash: hash }), { mode: 0o600 });
  const input: SnapshotInput = { sourceDbPath, projectionRoot, outputDir, key: randomBytes(32), retain: 24 };
  let number = 0;
  const take = (extra: Partial<SnapshotInput> = {}) => { const at = new Date(1788990000000 + ++number * 1000); return runSnapshotOnce({ ...input, now: () => at, ...extra }); };
  const change = (value: string) => { const database = new DatabaseSync(sourceDbPath); database.prepare("UPDATE item SET note=?").run(value); database.close(); };
  return { root, input, take, change, layout: () => backupLayout(outputDir) };
}

export function clonePackages(fixture: ReturnType<typeof cacheFixture>, count: number): void {
  const layout = fixture.layout(), originals = readdirSync(layout.packagesDir).sort();
  for (let n = originals.length; n < count; n++) {
    const source = originals[n % originals.length];
    const manifest: SnapshotManifest = JSON.parse(readFileSync(join(layout.packagesDir, source, "manifest.json"), "utf8"));
    manifest.recovery_point_at = new Date(1788990000000 + (n + 1) * 1000).toISOString();
    const id = `${Date.parse(manifest.recovery_point_at)}_${manifest.contentHash.slice(0, 16)}`;
    mkdirSync(join(layout.packagesDir, id), { mode: 0o700 });
    writeFileSync(join(layout.packagesDir, id, "manifest.json"), JSON.stringify(manifest), { mode: 0o600 });
  }
}
