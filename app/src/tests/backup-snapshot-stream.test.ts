import fs from "node:fs";
import crypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSnapshotOnce } from "../server/backup-snapshot/core.ts";
import { archive, digest, encrypted, streamFixture, u32, type Entry } from "./helpers/backup-stream-fixture.ts";

const roots: string[] = [];
const fixture = (...args: Parameters<typeof streamFixture>) => { const f = streamFixture(...args); roots.push(f.root); return f; };
const check = (f: ReturnType<typeof fixture>) => {
  const finished = Error("VERIFICATION_ONLY_COMPLETE");
  try {
    runSnapshotOnce({ sourceDbPath: f.sourceDbPath, projectionRoot: f.projectionRoot, outputDir: f.root, key: f.key, retain: 24,
      onStage: event => { if (event.stage === "CAPTURE_DATABASE" && !event.failure) throw finished; } });
    throw Error("VERIFICATION_SENTINEL_NOT_REACHED");
  } catch (error) {
    if (error === finished) return [f.packageId];
    throw error;
  }
};
afterEach(() => {
  vi.restoreAllMocks(); syncBuiltinESMExports();
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});
const ordinary: Entry[] = [{ path: "db/snapshot.sqlite", data: Buffer.from("abcdef") },
  { path: "projection/generations/边界.json", data: Buffer.from("projection") }];

describe("streamed authenticated archive verification", () => {
  it("accepts multi-megabyte members, empty members, and the exact unordered member set", () => {
    const entries = [{ path: "projection/empty", data: Buffer.alloc(0) },
      { path: "db/snapshot.sqlite", data: Buffer.alloc(3 * 1024 * 1024 + 27, 0xa7) },
      { path: "projection/多字节.json", data: Buffer.from("valid utf8") }];
    const members = entries.map(e => ({ relativePath: e.path, bytes: e.data.length, sha256: digest(e.data) })).reverse();
    expect(check(fixture(entries, archive(entries), members))).toHaveLength(1);
  });

  it.each([1, 2, 3, 4, 5, 7, 17, 31, 4095])("accepts short reads of at most %i bytes across every field", limit => {
    const f = fixture(ordinary), read = fs.readSync;
    const spy = vi.spyOn(fs, "readSync").mockImplementation(((fd: number, buffer: Buffer, offset: number, length: number, position: number) =>
      read(fd, buffer, offset, Math.min(length, limit), position)) as typeof fs.readSync);
    syncBuiltinESMExports();
    expect(check(f)).toHaveLength(1); expect(spy).toHaveBeenCalled();
  });

  it.each([1, 2, 3, 5, 11, 19, 30])("accepts a member header crossing the 1 MiB boundary at offset %i", tail => {
    const firstPath = "db/snapshot.sqlite", headerBytes = 8 + 4 + Buffer.byteLength(firstPath) + 4;
    const f = fixture([{ path: firstPath, data: Buffer.alloc(1024 * 1024 - headerBytes - tail, 0xc5) }, ordinary[1]]);
    expect(check(f)).toHaveLength(1);
  });

  it("feeds non-empty final plaintext into the archive parser", () => {
    const f = fixture(ordinary), create = crypto.createDecipheriv;
    vi.spyOn(crypto, "createDecipheriv").mockImplementation(((...args: Parameters<typeof create>) => {
      const d = create(...args), update = d.update.bind(d), final = d.final.bind(d);
      let held = Buffer.alloc(0);
      d.update = ((input: Buffer) => {
        const all = Buffer.concat([held, update(input)]);
        const keep = Math.min(23, all.length); held = all.subarray(all.length - keep);
        return all.subarray(0, all.length - keep);
      }) as typeof d.update;
      d.final = (() => Buffer.concat([held, final()])) as typeof d.final;
      return d;
    }) as typeof create);
    syncBuiltinESMExports(); expect(check(f)).toHaveLength(1);
  });

  it("bounds parser/input buffers and never uses a full-object read", () => {
    const f = fixture([{ path: "db/snapshot.sqlite", data: Buffer.alloc(4 * 1024 * 1024 + 21) }, ordinary[1]]);
    const alloc = Buffer.alloc, sizes: number[] = [], reads: Array<string | number> = [], read = fs.readFileSync;
    vi.spyOn(Buffer, "alloc").mockImplementation(((size: number, ...args: unknown[]) => {
      sizes.push(size); return (alloc as (...args: unknown[]) => Buffer)(size, ...args);
    }) as typeof Buffer.alloc);
    vi.spyOn(fs, "readFileSync").mockImplementation(((path: string | number, ...args: unknown[]) => {
      reads.push(path); return (read as (...args: unknown[]) => unknown)(path, ...args);
    }) as typeof fs.readFileSync);
    syncBuiltinESMExports();
    expect(check(f)).toHaveLength(1); expect(Math.max(...sizes)).toBeLessThanOrEqual(1024 * 1024);
    // readFileSync is allowed for the small manifest only; the object uses readSync.
    expect(reads).not.toContain(f.objectPath);
    expect(sizes.filter(n => n === 1024 * 1024)).toHaveLength(1);
  });
});

describe("authenticated corruption and exact archive membership", () => {
  it.each(["tag", "ciphertext", "iv"] as const)("rejects damaged %s with authentication failure", kind => {
    const f = fixture(), data = fs.readFileSync(f.objectPath);
    data[kind === "tag" ? data.length - 1 : kind === "iv" ? 0 : 15] ^= 1;
    fs.writeFileSync(f.objectPath, data);
    expect(() => check(f)).toThrow("DECRYPT_FAILED");
  });
  it("rejects wrong AAD even when ciphertext and tag are otherwise intact", () => {
    const f = fixture(ordinary);
    fs.writeFileSync(f.objectPath, encrypted(archive(ordinary), f.key, f.kind + "-wrong", f.contentHash, f.keyId));
    expect(() => check(f)).toThrow("DECRYPT_FAILED");
  });

  const malformed = [
    ["magic", () => Buffer.concat([Buffer.from("XXXX"), archive(ordinary).subarray(4)]), "ARCHIVE_INVALID"],
    ["count", () => Buffer.concat([Buffer.from("F1PK"), u32(3), archive(ordinary).subarray(8)]), "PACKAGE_VERIFY_FAILED"],
    ["zero path length", () => Buffer.concat([archive(ordinary).subarray(0, 8), u32(0), archive(ordinary).subarray(12)]), "ARCHIVE_INVALID"],
    ["oversized path length", () => Buffer.concat([archive(ordinary).subarray(0, 8), u32(4097), archive(ordinary).subarray(12)]), "ARCHIVE_INVALID"],
    ["path escape", () => archive([{ path: "../escape", data: ordinary[0].data }, ordinary[1]]), "PATH_ESCAPE"],
    ["absolute path", () => archive([{ path: "/escape", data: ordinary[0].data }, ordinary[1]]), "PATH_ESCAPE"],
    ["backslash path", () => archive([{ path: "projection\\escape", data: ordinary[0].data }, ordinary[1]]), "PATH_ESCAPE"],
    ["duplicate member", () => archive([ordinary[0], ordinary[0]]), "ARCHIVE_INVALID"],
    ["unexpected member", () => archive([ordinary[0], { path: "projection/unexpected", data: ordinary[1].data }]), "PACKAGE_VERIFY_FAILED"],
    ["wrong member length", () => archive([{ ...ordinary[0], data: Buffer.from("short") }, ordinary[1]]), "PACKAGE_VERIFY_FAILED"],
    ["wrong member hash", () => archive([{ ...ordinary[0], data: Buffer.from("ABCDEF") }, ordinary[1]]), "PACKAGE_VERIFY_FAILED"],
    ["trailing byte", () => Buffer.concat([archive(ordinary), Buffer.from([1])]), "ARCHIVE_INVALID"],
    ["truncated payload", () => archive(ordinary).subarray(0, -1), "ARCHIVE_INVALID"],
    ["truncated header", () => Buffer.from("F1PK\0"), "ARCHIVE_INVALID"],
    ["truncated path", () => archive(ordinary).subarray(0, 15), "ARCHIVE_INVALID"],
    ["truncated data length", () => archive(ordinary).subarray(0, 12 + Buffer.byteLength(ordinary[0].path) + 2), "ARCHIVE_INVALID"]
  ] as const;
  it.each(malformed)("rejects authenticated %s", (_name, build, reason) => {
    expect(() => check(fixture(ordinary, build()))).toThrow(reason);
  });
  it.each(malformed)("authenticates before revealing the %s parse error", (_name, build) => {
    const f = fixture(ordinary, build()), data = fs.readFileSync(f.objectPath);
    data[data.length - 1] ^= 1; fs.writeFileSync(f.objectPath, data);
    expect(() => check(f)).toThrow("DECRYPT_FAILED");
  });
  it.each([0, 1, 12, 28])("rejects a physically truncated object of %i bytes", length => {
    const f = fixture(); fs.truncateSync(f.objectPath, length);
    expect(() => check(f)).toThrow("DECRYPT_FAILED");
  });
  it("rejects duplicate expected members instead of collapsing the manifest's exact set", () => {
    const member = { relativePath: ordinary[0].path, bytes: ordinary[0].data.length, sha256: digest(ordinary[0].data) };
    expect(() => check(fixture(ordinary, archive(ordinary), [member, member]))).toThrow("PACKAGE_VERIFY_FAILED");
  });
  it("handles a 4096-byte path without allocating according to data length", () => {
    const f = fixture([{ path: "p/" + "x".repeat(4094), data: Buffer.alloc(0) }, ordinary[1]]);
    expect(check(f)).toHaveLength(1);
  });
  it("fails closed on a declared 4 GiB member without allocating it", () => {
    const raw = archive(ordinary), at = 12 + Buffer.byteLength(ordinary[0].path); raw.writeUInt32LE(0xffffffff, at);
    const f = fixture(ordinary, raw), alloc = Buffer.alloc, sizes: number[] = [];
    vi.spyOn(Buffer, "alloc").mockImplementation(((size: number, ...args: unknown[]) => {
      sizes.push(size); return (alloc as (...args: unknown[]) => Buffer)(size, ...args);
    }) as typeof Buffer.alloc);
    expect(() => check(f)).toThrow("PACKAGE_VERIFY_FAILED"); expect(Math.max(...sizes)).toBeLessThanOrEqual(1024 * 1024);
  });
});

describe("held descriptor, path identity and failure ordering", () => {
  it.each(["before-open", "after-open", "after-read", "tag-bad-and-replaced"] as const)("rejects physical replacement %s and closes its fd", when => {
    const f = fixture(ordinary);
    if (when === "tag-bad-and-replaced") { const data = fs.readFileSync(f.objectPath); data[data.length - 1] ^= 1; fs.writeFileSync(f.objectPath, data); }
    const original = fs.readFileSync(f.objectPath), open = fs.openSync, read = fs.readSync;
    let objectFd: number | undefined, replaced = false;
    const replace = () => {
      if (replaced) return; replaced = true;
      fs.renameSync(f.objectPath, f.objectPath + ".preserved"); fs.writeFileSync(f.objectPath, original, { mode: 0o600 });
    };
    vi.spyOn(fs, "openSync").mockImplementation(((path: string, flags: number, ...args: unknown[]) => {
      if (path === f.objectPath && when === "before-open") replace();
      const fd = (open as (...args: unknown[]) => number)(path, flags, ...args);
      if (path === f.objectPath) { objectFd = fd; if (when === "after-open") replace(); }
      return fd;
    }) as typeof fs.openSync);
    vi.spyOn(fs, "readSync").mockImplementation(((fd: number, ...args: unknown[]) => {
      const n = (read as (...args: unknown[]) => number)(fd, ...args);
      if (fd === objectFd && (when === "after-read" || when === "tag-bad-and-replaced")) replace();
      return n;
    }) as typeof fs.readSync);
    syncBuiltinESMExports();
    expect(() => check(f)).toThrow("OBJECT_IDENTITY_CHANGED"); expect(replaced).toBe(true);
    expect(objectFd).toBeDefined(); expect(() => fs.fstatSync(objectFd!)).toThrow();
    expect(fs.readFileSync(f.objectPath + ".preserved")).toEqual(original);
  });
  it("rejects same-inode mutation even if mtime is reset", () => {
    const f = fixture(ordinary), original = fs.readFileSync(f.objectPath), stat = fs.statSync(f.objectPath), read = fs.readSync;
    let changed = false;
    vi.spyOn(fs, "readSync").mockImplementation(((...args: Parameters<typeof fs.readSync>) => {
      const n = read(...args);
      if (!changed && fs.fstatSync(args[0]).ino === stat.ino) { changed = true; const data = Buffer.from(original); data[data.length - 1] ^= 1;
        fs.writeFileSync(f.objectPath, data); fs.utimesSync(f.objectPath, stat.atime, stat.mtime); }
      return n;
    }) as typeof fs.readSync);
    syncBuiltinESMExports(); expect(() => check(f)).toThrow("OBJECT_IDENTITY_CHANGED");
  });
  it("rejects a symlink and a hard-linked object", () => {
    const f = fixture(ordinary), original = f.objectPath + ".preserved";
    fs.renameSync(f.objectPath, original); fs.symlinkSync(original, f.objectPath);
    expect(() => check(f)).toThrow("OBJECT_IDENTITY_CHANGED");
    fs.unlinkSync(f.objectPath); fs.linkSync(original, f.objectPath);
    expect(() => check(f)).toThrow("OBJECT_IDENTITY_CHANGED");
  });
  it("keeps identity failure ahead of an authenticated parser error", () => {
    const f = fixture(ordinary, Buffer.from("authenticated malformed archive")), read = fs.readSync;
    const original = fs.readFileSync(f.objectPath), inode = fs.statSync(f.objectPath).ino; let replaced = false;
    vi.spyOn(fs, "readSync").mockImplementation(((...args: Parameters<typeof fs.readSync>) => {
      const n = read(...args);
      if (!replaced && fs.fstatSync(args[0]).ino === inode) { replaced = true; fs.renameSync(f.objectPath, f.objectPath + ".preserved"); fs.writeFileSync(f.objectPath, original); }
      return n;
    }) as typeof fs.readSync);
    syncBuiltinESMExports(); expect(() => check(f)).toThrow("OBJECT_IDENTITY_CHANGED");
  });
});
