/**
 * Phase-1 only: serve admin-ui static + read-only /api/admin/ops/health on 127.0.0.1:3101.
 * Not a substitute for full admin-service (Passkey/Tailscale/reviews). Stop before enabling real admin.
 */
import { createServer } from "node:http";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { readOpsLocalHealth } from "../src/server/admin-service/ops-local-health.ts";

const HOST = "127.0.0.1";
const PORT = 3101;
const staticRoot = resolve(import.meta.dirname, "../src/admin-ui");

const routes: Record<string, { file: string; type: string }> = {
  "/admin/ops": { file: "ops.html", type: "text/html; charset=utf-8" },
  "/admin/ops/": { file: "ops.html", type: "text/html; charset=utf-8" },
  "/admin/assets/ops.js": { file: "ops.js", type: "text/javascript; charset=utf-8" },
  "/admin/assets/app.css": { file: "app.css", type: "text/css; charset=utf-8" },
  "/admin/reviews": { file: "index.html", type: "text/html; charset=utf-8" },
  "/admin/reviews/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/admin/sources": { file: "sources.html", type: "text/html; charset=utf-8" },
  "/admin/settings": { file: "settings.html", type: "text/html; charset=utf-8" },
  "/admin/assets/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/admin/assets/sources.js": { file: "sources.js", type: "text/javascript; charset=utf-8" },
  "/admin/assets/settings.js": { file: "settings.js", type: "text/javascript; charset=utf-8" },
  "/admin/assets/settings.css": { file: "settings.css", type: "text/css; charset=utf-8" }
};

function isLoopback(addr: string | undefined): boolean {
  return addr === "127.0.0.1" || addr === "::1" || addr === ":ffff:127.0.0.1";
}

const server = createServer((req, res) => {
  const remote = req.socket.remoteAddress;
  if (!isLoopback(remote)) {
    res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ reasonCode: "LOCALHOST_ONLY" }));
    return;
  }
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
  const path = url.pathname;

  if (req.method === "GET" && path === "/api/admin/ops/health") {
    const body = JSON.stringify(readOpsLocalHealth());
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-f1plus1-preview": "ops-health-phase1"
    });
    res.end(body);
    return;
  }

  if (path.startsWith("/api/admin/")) {
    res.writeHead(401, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({
      reasonCode: "ADMIN_SESSION_REQUIRED",
      note: "Phase-1 preview only exposes GET /api/admin/ops/health. Full admin-service is not running."
    }));
    return;
  }

  const route = routes[path];
  if ((req.method === "GET" || req.method === "HEAD") && route) {
    const filePath = join(staticRoot, route.file);
    if (!existsSync(filePath) || !lstatSync(filePath).isFile()) {
      res.writeHead(404);
      res.end("missing");
      return;
    }
    const bytes = readFileSync(filePath);
    res.writeHead(200, {
      "content-type": route.type,
      "content-length": bytes.length,
      "cache-control": "no-store",
      "x-f1plus1-preview": "ops-health-phase1"
    });
    res.end(req.method === "HEAD" ? undefined : bytes);
    return;
  }

  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Phase-1 preview: try GET /admin/ops or GET /api/admin/ops/health");
});

server.listen(PORT, HOST, () => {
  process.stdout.write(JSON.stringify({
    event: "ops_health_phase1_preview_listening",
    url: `http://${HOST}:${PORT}/admin/ops`,
    health: `http://${HOST}:${PORT}/api/admin/ops/health`,
    staticRoot
  }) + "\n");
});
