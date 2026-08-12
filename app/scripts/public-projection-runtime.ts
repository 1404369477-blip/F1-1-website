import { createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";

import { readPublicProjectionDeploymentManifest } from "../src/server/public/deployment.ts";
import { ProjectionReceiver } from "../src/server/review-real/projection.ts";
import {
  createProjectionReceiverServer,
  listenProjectionReceiver
} from "../src/server/review-real/receiver-http.ts";
import { runSafeCli } from "../src/server/security/cli.ts";

await runSafeCli(async () => {
  process.umask(0o077);
  const arguments_ = process.argv.slice(2);
  if (arguments_.length !== 2 || arguments_[0] !== "--manifest" || !arguments_[1].startsWith("/")) {
    throw new Error("CLI_ARGUMENTS_FORBIDDEN");
  }
  const manifest = readPublicProjectionDeploymentManifest(arguments_[1]);
  const receiver = new ProjectionReceiver({
    root: manifest.publicProjectionRoot,
    signingKeyId: manifest.projectionSigningKeyId,
    publicKey: createPublicKey(readFileSync(manifest.projectionVerifyKeyPath, "utf8"))
  });
  const server = createProjectionReceiverServer({
    receiver,
    senderServiceIdentity: manifest.projectionSenderServiceIdentity
  });
  let stop: (() => void) | undefined;
  const stopped = new Promise<void>((resolveStop) => { stop = resolveStop; });
  const requestStop = (): void => stop?.();
  process.once("SIGINT", requestStop);
  process.once("SIGTERM", requestStop);
  try {
    await listenProjectionReceiver(server);
    await stopped;
  } finally {
    process.off("SIGINT", requestStop);
    process.off("SIGTERM", requestStop);
    if (server.listening) await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }
});
