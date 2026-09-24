import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as closure from "../server/release/local-closure.ts";
import { BACKUP_RUNTIME_MANIFEST, prepareBackupRuntime, verifyBackupRuntime } from "../../scripts/prepare-backup-runtime.ts";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), "f1-backup-runtime-test-"));
  roots.push(root);
  const source = resolve(root, "source");
  const target = resolve(root, "candidate");
  mkdirSync(resolve(source, "scripts"), { recursive: true, mode: 0o700 });
  mkdirSync(resolve(source, "src"), { mode: 0o700 });
  mkdirSync(resolve(source, "src/server/backup-snapshot"), { recursive: true, mode: 0o700 });
  const write = (path: string, bytes: string) => writeFileSync(resolve(source, path), bytes, { mode: 0o600 });
  write("package.json", '{"type":"module"}');
  write("package-lock.json", '{"lockfileVersion":3}');
  write("tsconfig.json", '{"compilerOptions":{"target":"ESNext","module":"NodeNext","moduleResolution":"NodeNext"},"include":["scripts/**/*.ts","src/**/*.ts"]}');
  write("src/shared.ts", 'export const value = 1;');
  write("src/server/backup-snapshot/application-public-check.ts", 'export const check = true;');
  for (const name of ["backup-snapshot-once", "backup-restore-drill", "backup-recovery-point-register", "backup-off-host-observe"]) {
    write(`scripts/${name}.ts`, 'import { value } from "../src/shared.ts"; export const result = value;');
  }
  write(".env", "DO_NOT_COPY=secret");
  write("private.sqlite", "database");
  return { root, source, target, write };
}
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("isolated backup CLI runtime release", () => {
  it("copies the local closure and verifies without loading candidate code", () => {
    const f = fixture();
    f.write("scripts/backup-snapshot-once.ts", 'import { value } from "../src/shared.ts"; throw new Error("MUST_NOT_EXECUTE"); export { value };');
    const manifest = prepareBackupRuntime(f.source, f.target);
    expect(manifest.files).toHaveLength(9);
    expect(manifest.files.map((file) => file.path)).toContain("src/server/backup-snapshot/application-public-check.ts");
    expect(manifest.files.map((file) => file.path)).not.toContain(".env");
    expect(manifest.files.map((file) => file.path)).not.toContain("private.sqlite");
    expect(verifyBackupRuntime(f.target, manifest.rootSha256)).toEqual(manifest);
    f.write("src/shared.ts", "export const value = 2;");
    expect(readFileSync(resolve(f.target, "src/shared.ts"), "utf8")).toBe("export const value = 1;");
    expect(verifyBackupRuntime(f.target, manifest.rootSha256)).toEqual(manifest);
  });
  it("rejects file changes, mismatched receipt roots, and extra runtime files", () => {
    const f = fixture();
    const manifest = prepareBackupRuntime(f.source, f.target);
    expect(() => verifyBackupRuntime(f.target, "0".repeat(64))).toThrow("MANIFEST_INVALID");
    writeFileSync(resolve(f.target, "src/shared.ts"), "tampered", { mode: 0o600 });
    expect(() => verifyBackupRuntime(f.target, manifest.rootSha256)).toThrow("FILE_IDENTITY_MISMATCH");
    writeFileSync(resolve(f.target, "src/shared.ts"), "export const value = 1;", { mode: 0o600 });
    writeFileSync(resolve(f.target, "extra.ts"), "extra", { mode: 0o600 });
    expect(() => verifyBackupRuntime(f.target, manifest.rootSha256)).toThrow("TARGET_INVENTORY_MISMATCH");
  });
  it("rejects an existing target without changing its contents", () => {
    const f = fixture();
    mkdirSync(f.target, { mode: 0o700 });
    writeFileSync(resolve(f.target, "keep"), "original");
    expect(() => prepareBackupRuntime(f.source, f.target)).toThrow();
    expect(readFileSync(resolve(f.target, "keep"), "utf8")).toBe("original");
    expect(() => prepareBackupRuntime(f.source, resolve(f.source, "nested"))).toThrow("SOURCE_TARGET_OVERLAP");
  });
  it("rejects imports escaping source, source links, and external dependencies", () => {
    const f = fixture();
    writeFileSync(resolve(f.root, "outside.ts"), "export const value = 2;", { mode: 0o600 });
    f.write("scripts/backup-snapshot-once.ts", 'import "../../outside.ts";');
    expect(() => prepareBackupRuntime(f.source, f.target)).toThrow();
    expect(() => readFileSync(resolve(f.target, BACKUP_RUNTIME_MANIFEST))).toThrow();
    f.write("scripts/backup-snapshot-once.ts", 'import "unknown-third-party";');
    expect(() => prepareBackupRuntime(f.source, resolve(f.root, "external"))).toThrow("EXTERNAL_DEPENDENCY");
    f.write("scripts/backup-snapshot-once.ts", 'import "../src/linked.ts";');
    symlinkSync(resolve(f.root, "outside.ts"), resolve(f.source, "src/linked.ts"));
    expect(() => prepareBackupRuntime(f.source, resolve(f.root, "linked"))).toThrow();
  });
  it("rejects a source change during preparation and leaves no completion manifest", () => {
    const f = fixture();
    const read = closure.readStableRegularFile;
    let reads = 0;
    vi.spyOn(closure, "readStableRegularFile").mockImplementation((root, path) => {
      if (root === realpathSync(f.source) && path === "src/shared.ts" && ++reads === 2) {
        f.write("src/shared.ts", "export const value = 9;");
      }
      return read(root, path);
    });
    expect(() => prepareBackupRuntime(f.source, f.target)).toThrow("SOURCE_CHANGED");
    expect(() => readFileSync(resolve(f.target, BACKUP_RUNTIME_MANIFEST))).toThrow();
  });
  it("rejects missing source files and candidate links", () => {
    const f = fixture();
    const manifest = prepareBackupRuntime(f.source, f.target);
    rmSync(resolve(f.target, "src/shared.ts"));
    symlinkSync(resolve(f.source, "src/shared.ts"), resolve(f.target, "src/shared.ts"));
    expect(() => verifyBackupRuntime(f.target, manifest.rootSha256)).toThrow();
    rmSync(resolve(f.source, "src/shared.ts"));
    expect(() => prepareBackupRuntime(f.source, resolve(f.root, "missing"))).toThrow();
  });
});
