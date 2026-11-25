import { spawn } from "node:child_process";
import { createServer, type IncomingMessage } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { PAGES_ARTIFACT_MAX_BYTES, PAGES_ARTIFACT_MAX_FILES } from "../server/lean/pages-publish.ts";

const yaml = readFileSync(fileURLToPath(new URL("../../scripts/pages-workflow.yml", import.meta.url)), "utf8");
const RUNTIME_MARKER = "rt_TESTMARKER_SHOULD_NOT_LEAK";
const REST_MARKER = "ghp_TESTMARKER_SHOULD_NOT_LEAK";
const SIG_MARKER = "sigmarkerSHOULDNOTLEAK";
const BODY_MARKER = "SECRET_BODY_MARKER";

function extractGate(source: string): string {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line.includes("# BEGIN pages-artifact-gate"));
  const end = lines.findIndex((line) => line.includes("# END pages-artifact-gate"));
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const block = lines.slice(start, end + 1);
  const indent = block.reduce((min, line) => {
    if (line.trim() === "") return min;
    return Math.min(min, line.match(/^[ ]*/)?.[0].length ?? 0);
  }, 80);
  return `${block.map((line) => line.slice(indent)).join("\n")}\n`;
}

const gate = extractGate(yaml);

function fakeRuntimeToken(): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode({ scp: "Actions.Results:run-backend:job-backend" })}.${RUNTIME_MARKER}.${SIG_MARKER}`;
}

function runGate(env: Record<string, string>): Promise<{ status: number | null; stdout: string; stderr: string; output: string }> {
  const dir = mkdtempSync(join(tmpdir(), "pages-gate-"));
  const file = join(dir, "gate.py");
  const output = join(dir, "github-output.txt");
  writeFileSync(file, gate);
  writeFileSync(output, "");
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [file], {
      env: {
        PATH: process.env.PATH ?? "",
        PYTHONUNBUFFERED: "1",
        PYTHONNOUSERSITE: "1",
        GITHUB_OUTPUT: output,
        ...env
      }
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr, output: readFileSync(output, "utf8") });
    });
  });
}

function assertNoSecrets(text: string): void {
  expect(text).not.toContain(RUNTIME_MARKER);
  expect(text).not.toContain(REST_MARKER);
  expect(text).not.toContain(SIG_MARKER);
  expect(text).not.toContain(BODY_MARKER);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function withServer(handler: (url: URL, body: string, respond: (status: number, payload: unknown) => void) => void | Promise<void>): Promise<{ base: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        const body = await readBody(req);
        await handler(url, body, (status, payload) => {
          res.writeHead(status, { "content-type": "application/json", connection: "close" });
          res.end(JSON.stringify(payload));
        });
      } catch {
        res.writeHead(500, { connection: "close" });
        res.end("{}");
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("test server did not bind");
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };
}

function listedArtifact(count: number) {
  return {
    artifacts: Array.from({ length: count }, (_, index) => ({
      name: "github-pages",
      databaseId: String(100 + index),
      size: "10",
      id: 100 + index,
      size_in_bytes: 10,
      expired: false
    })),
    total_count: count
  };
}

describe("pages publish workflow", () => {
  it("keeps the artifact budget, deploy cap, branch head, and a bounded metadata wait", () => {
    expect(yaml).toContain("cancel-in-progress: false");
    expect(yaml).not.toContain("cancel-in-progress: true");
    expect(yaml.split("timeout: 600000")).toHaveLength(3);
    expect(yaml).not.toContain("1200000");
    expect(yaml).toContain(`max_files = ${PAGES_ARTIFACT_MAX_FILES}`);
    expect(yaml).toContain(`max_bytes = ${PAGES_ARTIFACT_MAX_BYTES}`);
    expect(yaml).toContain('test "$current" = "$GITHUB_SHA"');
    expect(yaml).toContain("actions: read");
    expect(yaml).toContain("checks: read");
    expect(yaml).toContain('PAGES_ARTIFACT_WAIT_SECONDS: "180"');
    expect(yaml).toContain('PAGES_ARTIFACT_POLL_SECONDS: "5"');
    expect(yaml).toContain('PAGES_DEPLOY_CLASSIFY_SECONDS: "30"');
    expect(yaml).toContain('PAGES_DEPLOY_RETRY_PAUSE_SECONDS: "10"');
    expect(yaml.split("continue-on-error: true")).toHaveLength(3);
    expect(yaml.split("actions/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e")).toHaveLength(3);
    expect(yaml).toContain("actions/github-script@ed597411d8f924073f98dfc5c65a23a2325f34cd");
    expect(yaml).toContain('core.exportVariable("ACTIONS_RUNTIME_TOKEN", token)');
    expect(yaml).toContain('core.exportVariable("ACTIONS_RESULTS_URL", resultsUrl)');
    expect(yaml).toContain("core.setSecret(token)");
    expect(yaml).toContain("steps.deployment.outputs.page_url == ''");
    expect(yaml).toContain("steps.deploy_class.outputs.retry != 'false'");
    expect(yaml).toContain("!cancelled()");
    expect(yaml).not.toContain("steps.deploy_class.outputs.retry == 'true'");
    expect(yaml).not.toContain("github-pages artifact is listed on the Actions API");
    expect(yaml).not.toContain('No artifacts named "github-pages" were found');

    const head = yaml.indexOf("Require current branch head");
    const expose = yaml.indexOf("Expose the artifact results credentials");
    const wait = yaml.indexOf("Wait until github-pages is listed for this run");
    const deploy = yaml.indexOf("Deploy to GitHub Pages");
    const classify = yaml.indexOf("Classify a missing github-pages artifact");
    const retry = yaml.indexOf("Retry deploy when artifact metadata was missing");
    const classifyStep = yaml.slice(classify, retry);
    expect(head).toBeGreaterThan(yaml.indexOf("actions/upload-pages-artifact@"));
    expect(expose).toBeGreaterThan(head);
    expect(wait).toBeGreaterThan(expose);
    expect(deploy).toBeGreaterThan(wait);
    expect(classify).toBeGreaterThan(deploy);
    expect(retry).toBeGreaterThan(classify);
    expect(classifyStep).toContain("continue-on-error: true");
    expect(yaml.indexOf("continue-on-error: true")).toBeLessThan(retry);
  });

  it("waits until the results list and the Actions API both show one artifact", async () => {
    let resultsCalls = 0;
    const server = await withServer(async (url, body, respond) => {
      if (url.pathname.endsWith("/ListArtifacts")) {
        resultsCalls += 1;
        const posted = JSON.parse(body) as { workflowRunBackendId?: string; workflowJobRunBackendId?: string };
        expect(posted.workflowRunBackendId).toBe("run-backend");
        expect(posted.workflowJobRunBackendId).toBe("job-backend");
        respond(200, resultsCalls < 3 ? listedArtifact(0) : listedArtifact(1));
        return;
      }
      respond(200, listedArtifact(1));
    });
    try {
      const result = await runGate({
        PAGES_ARTIFACT_COMMAND: "wait",
        PAGES_ARTIFACT_WAIT_SECONDS: "2",
        PAGES_ARTIFACT_POLL_SECONDS: "0.05",
        GITHUB_API_URL: server.base,
        GITHUB_REPOSITORY: "acme/f1",
        GITHUB_RUN_ID: "99",
        GH_TOKEN: REST_MARKER,
        ACTIONS_RUNTIME_TOKEN: fakeRuntimeToken(),
        ACTIONS_RESULTS_URL: `${server.base}/ignored?sig=${SIG_MARKER}`
      });
      expect(result.status).toBe(0);
      expect(resultsCalls).toBeGreaterThanOrEqual(3);
      expect(result.stdout).toContain("github-pages artifact is listed");
      assertNoSecrets(result.stdout + result.stderr);
    } finally {
      await server.close();
    }
  });

  it("fails closed when the results list stays empty for the whole bound", async () => {
    const server = await withServer(async (url, _body, respond) => {
      respond(200, url.pathname.endsWith("/ListArtifacts") ? listedArtifact(0) : listedArtifact(1));
    });
    try {
      const result = await runGate({
        PAGES_ARTIFACT_COMMAND: "wait",
        PAGES_ARTIFACT_WAIT_SECONDS: "0.35",
        PAGES_ARTIFACT_POLL_SECONDS: "0.05",
        GITHUB_API_URL: server.base,
        GITHUB_REPOSITORY: "acme/f1",
        GITHUB_RUN_ID: "99",
        GH_TOKEN: REST_MARKER,
        ACTIONS_RUNTIME_TOKEN: fakeRuntimeToken(),
        ACTIONS_RESULTS_URL: server.base
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("PAGES_ARTIFACT_METADATA_TIMEOUT");
      assertNoSecrets(result.stdout + result.stderr);
    } finally {
      await server.close();
    }
  });

  it("stops immediately when more than one github-pages artifact is listed", async () => {
    let calls = 0;
    const server = await withServer(async (_url, _body, respond) => {
      calls += 1;
      respond(200, listedArtifact(2));
    });
    try {
      const result = await runGate({
        PAGES_ARTIFACT_COMMAND: "wait",
        PAGES_ARTIFACT_WAIT_SECONDS: "2",
        PAGES_ARTIFACT_POLL_SECONDS: "0.05",
        GITHUB_API_URL: server.base,
        GITHUB_REPOSITORY: "acme/f1",
        GITHUB_RUN_ID: "99",
        GH_TOKEN: REST_MARKER,
        ACTIONS_RUNTIME_TOKEN: fakeRuntimeToken(),
        ACTIONS_RESULTS_URL: server.base
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("PAGES_ARTIFACT_AMBIGUOUS");
      expect(calls).toBe(2);
    } finally {
      await server.close();
    }
  });

  it("does not print a results error body and still deploys once the list recovers", async () => {
    let resultsCalls = 0;
    const server = await withServer(async (url, _body, respond) => {
      if (url.pathname.endsWith("/ListArtifacts")) {
        resultsCalls += 1;
        if (resultsCalls === 1) {
          respond(500, { message: BODY_MARKER });
          return;
        }
      }
      respond(200, listedArtifact(1));
    });
    try {
      const result = await runGate({
        PAGES_ARTIFACT_COMMAND: "wait",
        PAGES_ARTIFACT_WAIT_SECONDS: "2",
        PAGES_ARTIFACT_POLL_SECONDS: "0.05",
        GITHUB_API_URL: server.base,
        GITHUB_REPOSITORY: "acme/f1",
        GITHUB_RUN_ID: "99",
        GH_TOKEN: REST_MARKER,
        ACTIONS_RUNTIME_TOKEN: fakeRuntimeToken(),
        ACTIONS_RESULTS_URL: `${server.base}/?sig=${SIG_MARKER}`
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("results_list=http_500");
      assertNoSecrets(result.stdout + result.stderr);
    } finally {
      await server.close();
    }
  });

  it("does not deploy on the first poll when the results list is unavailable and the Actions API already lists the artifact", async () => {
    let resultsCalls = 0;
    let apiCalls = 0;
    const server = await withServer(async (url, _body, respond) => {
      if (url.pathname.endsWith("/ListArtifacts")) {
        resultsCalls += 1;
        respond(401, { message: "not yet" });
        return;
      }
      apiCalls += 1;
      respond(200, listedArtifact(1));
    });
    try {
      const result = await runGate({
        PAGES_ARTIFACT_COMMAND: "wait",
        PAGES_ARTIFACT_WAIT_SECONDS: "0.35",
        PAGES_ARTIFACT_POLL_SECONDS: "0.05",
        GITHUB_API_URL: server.base,
        GITHUB_REPOSITORY: "acme/f1",
        GITHUB_RUN_ID: "99",
        GH_TOKEN: REST_MARKER,
        ACTIONS_RUNTIME_TOKEN: fakeRuntimeToken(),
        ACTIONS_RESULTS_URL: server.base
      });
      expect(result.status).toBe(0);
      expect(resultsCalls).toBeGreaterThanOrEqual(3);
      expect(apiCalls).toBeGreaterThanOrEqual(3);
      expect(result.stdout).toContain("results_list=http_401");
      expect(result.stdout).toContain("results service stayed unavailable for the full wait");
      expect(result.stdout).not.toContain("github-pages artifact is listed");
      assertNoSecrets(result.stdout + result.stderr);
    } finally {
      await server.close();
    }
  });

  it("keeps polling when the results credentials are missing even though the Actions API lists the artifact", async () => {
    let apiCalls = 0;
    const server = await withServer(async (url, _body, respond) => {
      expect(url.pathname.endsWith("/ListArtifacts")).toBe(false);
      apiCalls += 1;
      respond(200, listedArtifact(1));
    });
    try {
      const result = await runGate({
        PAGES_ARTIFACT_COMMAND: "wait",
        PAGES_ARTIFACT_WAIT_SECONDS: "0.35",
        PAGES_ARTIFACT_POLL_SECONDS: "0.05",
        GITHUB_API_URL: server.base,
        GITHUB_REPOSITORY: "acme/f1",
        GITHUB_RUN_ID: "99",
        GH_TOKEN: REST_MARKER
      });
      expect(result.status).toBe(0);
      expect(apiCalls).toBeGreaterThanOrEqual(3);
      expect(result.stdout).toContain("results_list=missing_credentials");
      expect(result.stdout).not.toContain("results_list=http_");
      expect(result.stdout).toContain("results service stayed unavailable for the full wait");
      expect(result.stdout).not.toContain("github-pages artifact is listed");
      assertNoSecrets(result.stdout + result.stderr);
    } finally {
      await server.close();
    }
  });

  it("deploys as soon as the results list shows the artifact after earlier unavailable polls", async () => {
    let resultsCalls = 0;
    const server = await withServer(async (url, _body, respond) => {
      if (url.pathname.endsWith("/ListArtifacts")) {
        resultsCalls += 1;
        if (resultsCalls < 3) {
          respond(401, {});
          return;
        }
        respond(200, listedArtifact(1));
        return;
      }
      respond(200, listedArtifact(1));
    });
    try {
      const result = await runGate({
        PAGES_ARTIFACT_COMMAND: "wait",
        PAGES_ARTIFACT_WAIT_SECONDS: "2",
        PAGES_ARTIFACT_POLL_SECONDS: "0.05",
        GITHUB_API_URL: server.base,
        GITHUB_REPOSITORY: "acme/f1",
        GITHUB_RUN_ID: "99",
        GH_TOKEN: REST_MARKER,
        ACTIONS_RUNTIME_TOKEN: fakeRuntimeToken(),
        ACTIONS_RESULTS_URL: server.base
      });
      expect(result.status).toBe(0);
      expect(resultsCalls).toBe(3);
      expect(result.stdout).toContain("github-pages artifact is listed");
      expect(result.stdout).not.toContain("grace period");
      assertNoSecrets(result.stdout + result.stderr);
    } finally {
      await server.close();
    }
  });

  it("proceeds after the bound when the results service is ready and the Actions API is still empty", async () => {
    const server = await withServer(async (url, _body, respond) => {
      respond(200, url.pathname.endsWith("/ListArtifacts") ? listedArtifact(1) : listedArtifact(0));
    });
    try {
      const result = await runGate({
        PAGES_ARTIFACT_COMMAND: "wait",
        PAGES_ARTIFACT_WAIT_SECONDS: "0.25",
        PAGES_ARTIFACT_POLL_SECONDS: "0.05",
        GITHUB_API_URL: server.base,
        GITHUB_REPOSITORY: "acme/f1",
        GITHUB_RUN_ID: "99",
        GH_TOKEN: REST_MARKER,
        ACTIONS_RUNTIME_TOKEN: fakeRuntimeToken(),
        ACTIONS_RESULTS_URL: server.base
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("actions_api lagging; results service lists github-pages");
    } finally {
      await server.close();
    }
  });

  it("rejects an unbounded wait and a missing poll command", async () => {
    const tooLong = await runGate({ PAGES_ARTIFACT_COMMAND: "wait", PAGES_ARTIFACT_WAIT_SECONDS: "181" });
    expect(tooLong.status).toBe(1);
    expect(tooLong.stderr).toContain("PAGES_ARTIFACT_WAIT_INVALID");
    const missing = await runGate({});
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("PAGES_ARTIFACT_COMMAND_INVALID");
    const unavailable = await runGate({ PAGES_ARTIFACT_COMMAND: "wait", PAGES_ARTIFACT_WAIT_SECONDS: "2" });
    expect(unavailable.status).toBe(1);
    expect(unavailable.stderr).toContain("PAGES_ARTIFACT_POLL_UNAVAILABLE");
  });

  it("retries only the missing-metadata failure and refuses timeouts or an existing deployment", async () => {
    const metadata = "Error: No artifacts named " + '"github-pages"' + " were found for this workflow run.";
    const cases = [
      { message: metadata, pageUrl: "", retry: true },
      { message: "Found 0 artifact(s)", pageUrl: "", retry: true },
      { message: "Timeout reached, aborting!", pageUrl: "", retry: false },
      { message: "Deployment failed, try again later.", pageUrl: "", retry: false },
      { message: "Artifact could not be deployed. Please ensure the content does not contain any hard links.", pageUrl: "", retry: false },
      { message: metadata, pageUrl: "https://f1plus1.com/", retry: false }
    ];
    for (const item of cases) {
      const location = { base: "" };
      const server = await withServer(async (url, _body, respond) => {
        if (url.pathname.endsWith("/jobs")) {
          respond(200, { jobs: [{ name: "deploy", check_run_url: `${location.base}/repos/acme/f1/check-runs/9` }] });
          return;
        }
        if (url.pathname.endsWith("/annotations")) {
          respond(200, [{ message: item.message }]);
          return;
        }
        respond(200, listedArtifact(1));
      });
      location.base = server.base;
      try {
        const result = await runGate({
          PAGES_ARTIFACT_COMMAND: "classify",
          PAGES_DEPLOY_CLASSIFY_SECONDS: "1",
          PAGES_DEPLOY_RETRY_PAUSE_SECONDS: "0",
          PAGES_ARTIFACT_POLL_SECONDS: "0.05",
          PAGES_DEPLOY_PAGE_URL: item.pageUrl,
          GITHUB_API_URL: server.base,
          GITHUB_REPOSITORY: "acme/f1",
          GITHUB_RUN_ID: "99",
          GITHUB_RUN_ATTEMPT: "1",
          GITHUB_JOB: "deploy",
          GH_TOKEN: REST_MARKER,
          ACTIONS_RUNTIME_TOKEN: fakeRuntimeToken(),
          ACTIONS_RESULTS_URL: server.base
        });
        if (item.retry) {
          expect(result.status).toBe(0);
          expect(result.output).toBe("retry=true\n");
          expect(result.stdout).toContain("retrying deploy once");
        } else if (item.pageUrl) {
          expect(result.status).toBe(1);
          expect(result.output).not.toContain("retry=");
        } else {
          expect(result.status).toBe(0);
          expect(result.output).toBe("retry=false\n");
          expect(result.stdout).toContain("not missing artifact metadata");
        }
        assertNoSecrets(result.stdout + result.stderr + result.output);
      } finally {
        await server.close();
      }
    }
  });

  it("retries once when annotations are not ready before the classify window ends", async () => {
    const location = { base: "" };
    const server = await withServer(async (url, _body, respond) => {
      if (url.pathname.endsWith("/jobs")) {
        respond(200, { jobs: [{ name: "deploy", check_run_url: `${location.base}/repos/acme/f1/check-runs/9` }] });
        return;
      }
      respond(200, []);
    });
    location.base = server.base;
    try {
      const result = await runGate({
        PAGES_ARTIFACT_COMMAND: "classify",
        PAGES_DEPLOY_CLASSIFY_SECONDS: "0.3",
        PAGES_DEPLOY_RETRY_PAUSE_SECONDS: "0",
        PAGES_ARTIFACT_POLL_SECONDS: "0.05",
        PAGES_DEPLOY_PAGE_URL: "",
        GITHUB_API_URL: server.base,
        GITHUB_REPOSITORY: "acme/f1",
        GITHUB_RUN_ID: "99",
        GITHUB_JOB: "deploy",
        GH_TOKEN: REST_MARKER
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("not classified as missing artifact metadata");
      expect(result.stdout).toContain("retrying deploy once");
      expect(result.output).toBe("retry=true\n");
      assertNoSecrets(result.stdout + result.stderr + result.output);
    } finally {
      await server.close();
    }
  });

  it("retries once when the checks API cannot be read and does not fail the classify command", async () => {
    const server = await withServer(async (_url, _body, respond) => {
      respond(500, { message: "annotations not ready" });
    });
    try {
      const result = await runGate({
        PAGES_ARTIFACT_COMMAND: "classify",
        PAGES_DEPLOY_CLASSIFY_SECONDS: "0.25",
        PAGES_DEPLOY_RETRY_PAUSE_SECONDS: "0",
        PAGES_ARTIFACT_POLL_SECONDS: "0.05",
        PAGES_DEPLOY_PAGE_URL: "",
        GITHUB_API_URL: server.base,
        GITHUB_REPOSITORY: "acme/f1",
        GITHUB_RUN_ID: "99",
        GITHUB_JOB: "deploy",
        GH_TOKEN: REST_MARKER
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("retrying deploy once");
      expect(result.output).toBe("retry=true\n");
      expect(result.stderr).not.toContain("Error");
    } finally {
      await server.close();
    }
  });
});
