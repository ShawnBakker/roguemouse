import { createHash } from "node:crypto";

/**
 * Compute the SHA-256 hash of the UTF-8 bytes of `content` and return the
 * digest as a 64-character lowercase hexadecimal string.
 *
 * Used to hash canonical JSON for the audit log (per AC-16). The output
 * format is locked: 64 chars, lowercase, hex. This matches the format used
 * in S3 object keys (`audit/{runId}/{ts-safe}-{hash}.json`) and in S3
 * object metadata under the key `sha256`.
 */
export function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
