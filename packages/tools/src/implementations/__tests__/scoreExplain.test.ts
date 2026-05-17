import { describe, expect, it } from "vitest";

import { scoreExplain } from "../scoreExplain.js";
import { makeCtx } from "./testHelpers.js";

describe("scoreExplain (stub)", () => {
  it("returns the deterministic stub envelope for any valid input", async () => {
    const result = await scoreExplain(
      { strategy: "iv-rv-monitor", scoreValue: 42 },
      makeCtx(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.components).toHaveLength(3);
      expect(result.data.narrative).toContain("iv-rv-monitor");
      expect(result.data.narrative).toContain("42");
      for (const c of result.data.components) {
        expect(c.weight).toBeGreaterThanOrEqual(0);
        expect(c.weight).toBeLessThanOrEqual(10000);
        expect(Number.isInteger(c.contribution)).toBe(true);
      }
    }
  });

  it("returns the same components regardless of input (stub is deterministic)", async () => {
    const a = await scoreExplain(
      { strategy: "a", scoreValue: 1 },
      makeCtx(),
    );
    const b = await scoreExplain(
      { strategy: "b", scoreValue: 99 },
      makeCtx(),
    );
    if (a.ok && b.ok) {
      expect(a.data.components).toEqual(b.data.components);
    }
  });
});
