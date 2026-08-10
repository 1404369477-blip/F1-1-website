import { loadRuntimeConfig, appRoot, projectRoot } from "./runtime-config.ts";
import {
  createPublicMultimediaCanonical,
  resetPublicMultimediaCanonical
} from "../src/server/db/public-multimedia-synthetic.ts";
import { runSafeCli } from "../src/server/security/cli.ts";

await runSafeCli(() => {
  const argv = process.argv.slice(2);
  if (argv.length !== 1 || (argv[0] !== "create" && argv[0] !== "reset")) {
    throw new Error("PUBLIC_MULTIMEDIA_COMMAND: expected exactly create or reset");
  }
  const config = loadRuntimeConfig();
  const receipt = argv[0] === "create"
    ? createPublicMultimediaCanonical(config, appRoot, projectRoot)
    : resetPublicMultimediaCanonical(config, appRoot, projectRoot);
  process.stdout.write(`${JSON.stringify({ command: `public-multimedia:${argv[0]}`, ...receipt })}\n`);
});
