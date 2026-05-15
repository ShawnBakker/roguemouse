import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";

import { GENESIS_HASH, GENESIS_SEED } from "./genesis.js";

/**
 * The canonical pinned value of GENESIS_HASH. The source of truth is
 * `docs/sprints/smoke-test-vultr-integration/plan.md` (Phase 2 Step 0
 * preamble). If GENESIS_SEED ever changes, this literal MUST be updated
 * to match — otherwise this test catches the drift.
 */
const PINNED_GENESIS_HASH =
  "b44adada69b19012e01600e58f2fb29df2ae945ddf14f05dfa44eddde0a23bcc";

describe("GENESIS_SEED", () => {
  it("is the documented seed string", () => {
    expect(GENESIS_SEED).toBe("roguemouse-audit-genesis-v1");
  });
});

describe("GENESIS_HASH", () => {
  it("is a 64-character lowercase hex string", () => {
    expect(GENESIS_HASH).toMatch(/^[0-9a-f]{64}$/);
  });

  it("equals the pinned literal value from the plan", () => {
    expect(GENESIS_HASH).toBe(PINNED_GENESIS_HASH);
  });

  it("equals SHA-256(GENESIS_SEED) recomputed fresh inside the test", () => {
    const recomputed = createHash("sha256")
      .update(GENESIS_SEED, "utf8")
      .digest("hex");
    expect(recomputed).toBe(GENESIS_HASH);
    expect(recomputed).toBe(PINNED_GENESIS_HASH);
  });
});
