import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const [configFile, portRaw] = process.argv.slice(2);
const configRaw = readFileSync(configFile), configData = JSON.parse(configRaw);
const { installNoEgressGuard } = await import(pathToFileURL(`${configData.targetReleaseAppRoot}/src/server/vs1/no-egress.ts`));
const guard = installNoEgressGuard();
const { createReviewAdminRuntime, adminRuntimeConfigFromDeployment } = await import(pathToFileURL(`${configData.targetReleaseAppRoot}/src/server/admin-service/runtime.ts`));
const config = adminRuntimeConfigFromDeployment(configData, { allowDisposableReviewDatabase: true,
  expectedDeploymentManifestSha256: createHash('sha256').update(configRaw).digest('hex') });
const runtime = createReviewAdminRuntime(config);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  runtime.server.closeAllConnections();
  await new Promise(resolve => runtime.server.close(resolve));
  runtime.gateway?.close(); runtime.database.close();
  const externalCalls = guard.externalCalls;
  guard.restore();
  process.send?.({ type: 'closed', externalCalls });
  process.disconnect?.();
  process.exitCode = externalCalls === 0 ? 0 : 1;
}
process.on('message', message => { if (message === 'close') void close(); });
process.once('SIGTERM', () => void close());
process.once('SIGINT', () => void close());
await guard.listenExactLoopback(runtime.server, { host: '127.0.0.1', port: Number(portRaw) });
process.send?.({ type: 'ready', address: runtime.server.address(), externalCalls: guard.externalCalls });
