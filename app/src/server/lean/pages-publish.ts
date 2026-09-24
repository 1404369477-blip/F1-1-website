import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { PAGES_BRANCH, PAGES_DEPLOY_KEY, PAGES_HTTPS_REMOTE, PAGES_KNOWN_HOSTS, PAGES_REMOTE, PAGES_TOKEN_PATH, PAGES_UI_DIRECTORY, PAGES_WORKFLOW } from "./config.ts";
import type { SiteBundle } from "./site-bundle.ts";

const GIT_TIMEOUT_MS = 120_000;

type Git = (args: string[], allowFailure?: boolean) => { status: number; stdout: string };

function readToken(): string | null {
  if (!existsSync(PAGES_TOKEN_PATH)) return null;
  const token = readFileSync(PAGES_TOKEN_PATH, "utf8").trim();
  if (token === "") return null;
  if (!/^[A-Za-z0-9_]+$/.test(token)) throw new Error("PAGES_TOKEN_INVALID");
  return token;
}

/** HTTPS with the repo-scoped token when configured; otherwise the SSH deploy key. */
function createGit(cwd: string): { git: Git; remote: string } {
  const env: Record<string, string> = {
    HOME: cwd,
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    LANG: "C",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_SSH_COMMAND: `/usr/bin/ssh -F /dev/null -p 443 -i ${PAGES_DEPLOY_KEY} -o UserKnownHostsFile=${PAGES_KNOWN_HOSTS} -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15`
  };
  const token = readToken();
  if (token !== null) {
    // Passed through the environment so the token never appears in the process list.
    env.GIT_CONFIG_COUNT = "1";
    env.GIT_CONFIG_KEY_0 = "http.https://github.com/.extraheader";
    env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
  }
  const git: Git = (args, allowFailure = false) => {
    const result = spawnSync("/usr/bin/git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args],
      { cwd, env, encoding: "utf8", timeout: GIT_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
    const status = result.status ?? -1;
    if (!allowFailure && (result.error || status !== 0)) throw new Error(`GIT_${args[0]?.toUpperCase()}_FAILED: ${(result.stderr ?? "").slice(0, 300)}`);
    return { status, stdout: (result.stdout ?? "").trim() };
  };
  return { git, remote: token === null ? PAGES_REMOTE : PAGES_HTTPS_REMOTE };
}

const sha256File = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

/** Replaces the gh-pages tree with the UI shell plus `bundle`, then pushes one commit. */
export function publishBundle(checkout: string, bundle: SiteBundle): string {
  mkdirSync(checkout, { recursive: true, mode: 0o700 });
  const { git, remote } = createGit(checkout);
  if (!existsSync(join(checkout, ".git"))) git(["init", `--initial-branch=${PAGES_BRANCH}`]);
  git(["fetch", "--no-tags", "--depth=1", remote, PAGES_BRANCH]);
  git(["reset", "--hard", "FETCH_HEAD"]);
  stageSite(checkout, bundle);
  git(["add", "--all"]);
  git(["-c", "user.name=F1+1 Lean Publisher", "-c", "user.email=pages@users.noreply.github.com", "commit", "-q", "-m", `Publish ${bundle.itemCount} stories (${bundle.bundleId.slice(0, 12)})`]);
  git(["push", "--porcelain", remote, `HEAD:refs/heads/${PAGES_BRANCH}`]);
  return git(["rev-parse", "HEAD"]).stdout;
}

/** Writes the complete gh-pages tree (UI shell, bundle, workflow) into `root`, replacing everything but `.git`. */
export function stageSite(root: string, bundle: SiteBundle): void {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  for (const name of readdirSync(root)) if (name !== ".git") rmSync(join(root, name), { recursive: true, force: true });

  const site = join(root, "site");
  cpSync(PAGES_UI_DIRECTORY, site, { recursive: true });
  for (const [path, bytes] of bundle.files) {
    mkdirSync(dirname(join(site, path)), { recursive: true });
    writeFileSync(join(site, path), bytes);
  }
  writeFileSync(join(site, ".nojekyll"), "");
  writeFileSync(join(site, "_deployment.json"), JSON.stringify({
    schemaVersion: "public-static-deployment-v1",
    bundleId: bundle.bundleId,
    uiManifestSha256: sha256File(join(dirname(PAGES_UI_DIRECTORY), "ui.build-receipt.json")),
    workflowSha256: sha256File(PAGES_WORKFLOW)
  }));
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  cpSync(PAGES_WORKFLOW, join(root, ".github/workflows/pages.yml"));
  mkdirSync(join(root, ".sync"));
  writeFileSync(join(root, ".sync/publication.json"), JSON.stringify({
    schemaVersion: "lean-publication-v1",
    bundleId: bundle.bundleId,
    contentFingerprint: bundle.contentFingerprint
  }));
}
