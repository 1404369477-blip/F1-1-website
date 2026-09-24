import { afterEach, expect, test, vi } from "vitest";
import { constants, existsSync, fstatSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cacheFixture } from "./helpers/backup-cache-fixture.ts";

const hook = vi.hoisted(() => ({ before: null as null | ((path: unknown, flags: unknown) => void),
  after: null as null | ((path: unknown, flags: unknown, fd: number) => void) }));
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, openSync: (...args: Parameters<typeof actual.openSync>) => {
    hook.before?.(args[0], args[1]); const fd = actual.openSync(...args); hook.after?.(args[0], args[1], fd); return fd;
  } };
});
afterEach(() => { hook.before = null; hook.after = null; });

test.each(["parent-before-open", "parent-after-open", "lock-after-open"] as const)(
  "held lock creation preserves guarded writer rejection for %s", scenario => {
    const f = cacheFixture(), lock = f.layout().lockPath, foreign = join(f.root, "foreign"), moved = join(f.root, "moved");
    mkdirSync(foreign, { mode: 0o700 });
    let fired = false, openedFd: number | undefined;
    const matches = (path: unknown, flags: unknown) => path === lock && typeof flags === "number" && Boolean(flags & constants.O_CREAT);
    const replace = (path: unknown, flags: unknown) => {
      if (fired || !matches(path, flags)) return;
      fired = true;
      if (scenario.startsWith("parent")) { renameSync(dirname(lock), moved); symlinkSync(foreign, dirname(lock)); }
      else { renameSync(lock, moved); writeFileSync(lock, "foreign-lock", { mode: 0o600 }); }
    };
    try {
      if (scenario === "parent-before-open") hook.before = replace;
      hook.after = (path, flags, fd) => {
        if (!matches(path, flags)) return;
        openedFd = fd;
        if (scenario !== "parent-before-open") replace(path, flags);
      };
      expect(() => f.take()).toThrow();
      hook.before = null; hook.after = null;
      expect(fired).toBe(true); expect(openedFd).toBeDefined();
      expect(() => fstatSync(openedFd!)).toThrow();
      if (scenario === "parent-before-open") expect(readFileSync(join(foreign, "run.lock"))).toHaveLength(0);
      if (scenario === "parent-after-open") {
        expect(existsSync(join(foreign, "run.lock"))).toBe(false);
        expect(readFileSync(join(moved, "run.lock"))).toHaveLength(0);
      }
      if (scenario === "lock-after-open") {
        expect(readFileSync(lock, "utf8")).toBe("foreign-lock"); expect(readFileSync(moved)).toHaveLength(0);
      }
    } finally { hook.before = null; hook.after = null; rmSync(f.root, { recursive: true, force: true }); }
  }
);
