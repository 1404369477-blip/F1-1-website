// Isolated subprocess fixture: terminate after a real receiver commit, before
// the sender can persist any response or catch the lost transport result.
import { createPublicKey } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createReviewAdminRuntime, type AdminRuntimeConfig } from "../../server/admin-service/runtime.ts";
import { activateReleaseCandidate, type ReleaseCandidateManifest, type ReleasePairReceipt } from "../../server/internal-operation/release.ts";
import { ProjectionReceiver } from "../../server/review-real/projection.ts";
import { ProjectionHttpTransport } from "../../server/review-real/sender.ts";

if (process.env.NODE_ENV !== "test" || process.argv.length !== 3 || !process.argv[2].startsWith("/")) throw new Error("SYNTHETIC_CHILD_ONLY");
const input = JSON.parse(readFileSync(resolve(process.argv[2]), "utf8")) as {
  config: AdminRuntimeConfig; full: ReleaseCandidateManifest; pair: ReleasePairReceipt; root: string;
};
const gate = activateReleaseCandidate(input.full, input.pair, new Date().toISOString(), null);
const runtime = createReviewAdminRuntime({ ...input.config, releaseGate: gate });
const receiver = new ProjectionReceiver({ root: join(input.root, "started-public-projection"), signingKeyId: input.config.projectionSigningKeyId,
  publicKey: createPublicKey(readFileSync(input.config.projectionSigningPrivateKeyPath)), now: () => Date.now() });
ProjectionHttpTransport.prototype.post = async function (value) {
  const receipt = receiver.receive(value);
  writeFileSync(join(input.root, "started-child-post-receipt.json"), JSON.stringify(receipt), { mode: 0o600, flag: "wx" });
  process.exit(86);
};
await runtime.sender.tick();
throw new Error("SYNTHETIC_PROCESS_EXIT_NOT_REACHED");
