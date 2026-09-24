import { readFileSync, writeSync } from "node:fs";
import { runSnapshotOnce, type SnapshotInput, type SnapshotStage } from "../../server/backup-snapshot/core.ts";
const [fixturePath, stage] = process.argv.slice(2);
const input = JSON.parse(readFileSync(fixturePath, "utf8")) as SnapshotInput & { keyHex: string };
runSnapshotOnce({ ...input, key: Buffer.from(input.keyHex, "hex"), onStage: (diagnostic) => {
  writeSync(2, JSON.stringify(diagnostic) + "\n");
  if (diagnostic.stage === stage as SnapshotStage) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
} });
