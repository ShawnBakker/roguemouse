import { describe, expect, it } from "vitest";

import { policyCheck } from "../policyCheck.js";
import { makeCtx } from "./testHelpers.js";

describe("policyCheck (always-allow stub)", () => {
  it("returns allowed=true and empty violations for any well-formed action", async () => {
    const result = await policyCheck(
      { action: { type: "increase_position", details: { delta: 100 } } },
      makeCtx(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.allowed).toBe(true);
      expect(result.data.violations).toEqual([]);
    }
  });

  it("returns allowed=true regardless of action.type", async () => {
    const r1 = await policyCheck(
      { action: { type: "close_position", details: null } },
      makeCtx(),
    );
    const r2 = await policyCheck(
      { action: { type: "halt_strategy", details: { reason: "test" } } },
      makeCtx(),
    );
    expect(r1.ok && r1.data.allowed).toBe(true);
    expect(r2.ok && r2.data.allowed).toBe(true);
  });
});
