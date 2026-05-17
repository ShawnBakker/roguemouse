import { describe, expect, it } from "vitest";

import { marketDataLookup } from "../marketDataLookup.js";
import { DEFAULT_FIXTURES, makeCtx } from "./testHelpers.js";

describe("marketDataLookup", () => {
  it("returns a market-data entry for a known symbol", async () => {
    const result = await marketDataLookup({ symbol: "AAPL" }, makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(DEFAULT_FIXTURES.marketData.AAPL);
    }
  });

  it("returns unknown_symbol error for a symbol not in fixtures", async () => {
    const result = await marketDataLookup({ symbol: "TSLA" }, makeCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("unknown_symbol");
      expect(result.error.retryable).toBe(false);
      expect(result.error.message).toMatch(/TSLA/);
    }
  });

  it("does not throw if ctx access raises (defensive catch)", async () => {
    const ctx = makeCtx();
    Object.defineProperty(ctx, "fixtures", {
      get() {
        throw new Error("simulated ctx failure");
      },
    });
    const result = await marketDataLookup({ symbol: "AAPL" }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("tool_threw_internal");
      expect(result.error.retryable).toBe(false);
    }
  });
});
