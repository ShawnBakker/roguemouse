import { describe, expect, it } from "vitest";

import { brokerReconcile } from "../brokerReconcile.js";
import { makeCtx } from "./testHelpers.js";

describe("brokerReconcile", () => {
  it("returns broker positions for symbols matching the requested strategy", async () => {
    const result = await brokerReconcile(
      { strategy: "iv-rv-monitor" },
      makeCtx(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const symbols = result.data.brokerPositions.map((b) => b.symbol).sort();
      expect(symbols).toEqual(["AAPL", "MSFT"]);
    }
  });

  it("returns a one-symbol slice when strategy maps to one position", async () => {
    const result = await brokerReconcile(
      { strategy: "momentum-baseline" },
      makeCtx(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.brokerPositions).toHaveLength(1);
      expect(result.data.brokerPositions[0]?.symbol).toBe("GOOGL");
    }
  });

  it("returns an empty array when the strategy has no matching positions", async () => {
    const result = await brokerReconcile(
      { strategy: "no-such-strategy" },
      makeCtx(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.brokerPositions).toEqual([]);
    }
  });

  it("surfaces broker-side divergence preserved in fixtures", async () => {
    // MSFT internal quantity is 50; broker reports 49.
    const result = await brokerReconcile(
      { strategy: "iv-rv-monitor" },
      makeCtx(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const msft = result.data.brokerPositions.find((b) => b.symbol === "MSFT");
      expect(msft?.quantity).toBe(49);
    }
  });
});
