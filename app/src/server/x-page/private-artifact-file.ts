import { createHash } from "node:crypto";
import { readPrivateFile, type PrivateFile } from "../rss/private-credential-file.ts";

/** Keep the shared descriptor/path safety checks, while rejecting UTF-8 BOM
 * normalization. Artifact pins identify the bytes that were actually read.
 */
export function readXCapturePrivateFile(path: string, maxBytes: number): PrivateFile | null {
  const file = readPrivateFile(path, maxBytes);
  if (!file) return null;
  const rawSha256 = file.revisionInput.slice(file.revisionInput.lastIndexOf(":") + 1);
  const textSha256 = createHash("sha256").update(file.text, "utf8").digest("hex");
  if (!/^[0-9a-f]{64}$/.test(rawSha256) || rawSha256 !== textSha256) {
    throw new Error("X_CAPTURE_FILE_ENCODING_CHANGED");
  }
  return file;
}
