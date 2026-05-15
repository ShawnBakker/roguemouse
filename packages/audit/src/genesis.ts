import { createHash } from "node:crypto";

/**
 * The seed string for the audit-log hash chain's genesis hash.
 *
 * The `-v1` suffix is the format-version handle. If the audit log format
 * ever needs to break intentionally (e.g., schema rotation, hash algorithm
 * change), bump to `-v2` to produce a structurally distinct chain. Records
 * from a chain rooted at `-v1` cannot accidentally collide with records
 * from a chain rooted at `-v2`, because the genesis hash differs.
 */
export const GENESIS_SEED = "roguemouse-audit-genesis-v1" as const;

/**
 * The SHA-256 hash of `GENESIS_SEED`, encoded as 64-character lowercase
 * hexadecimal.
 *
 * Used as `previousHash` for the first record of every audit chain — i.e.,
 * the first record minted under any given `runId`. The smoke test writes
 * exactly one record per run, so every smoke-test record's `previousHash`
 * is this constant.
 *
 * Pinned literal (must equal the runtime computation below):
 *   b44adada69b19012e01600e58f2fb29df2ae945ddf14f05dfa44eddde0a23bcc
 *
 * The pinned value is the source of truth and is also recorded in
 * `docs/sprints/smoke-test-vultr-integration/plan.md`. The genesis unit
 * test asserts that the runtime computation matches the pinned literal;
 * if the runtime and the pin diverge, either `GENESIS_SEED` was modified
 * or the crypto path is broken.
 */
export const GENESIS_HASH: string = createHash("sha256")
  .update(GENESIS_SEED, "utf8")
  .digest("hex");
