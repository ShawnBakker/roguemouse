import { describe, expect, it } from "vitest";

import { positionSnapshot } from "../positionSnapshot.js";
import { DEFAULT_FIXTURES, makeCtx } from "./testHelpers.js";

describe("positionSnapshot", () => {
  it("returns all positions when no filters are supplied", async () => {
    const result = await positionSnapshot({}, makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.positions).toEqual(DEFAULT_FIXTURES.positions);
    }
  });

  it("filters by strategy", async () => {
    const result = await positionSnapshot(
      { strategy: "iv-rv-monitor" },
      makeCtx(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.positions.every((p) => p.strategy === "iv-rv-monitor")).toBe(
        true,
      );
      expect(result.data.positions).toHaveLength(2);
    }
  });

  it("filters by symbol", async () => {
    const result = await positionSnapshot({ symbol: "GOOGL" }, makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.positions).toHaveLength(1);
      expect(result.data.positions[0]?.symbol).toBe("GOOGL");
    }
  });

  it("applies both filters conjunctively", async () => {
    const result = await positionSnapshot(
      { strategy: "iv-rv-monitor", symbol: "AAPL" },
      makeCtx(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.positions).toHaveLength(1);
      expect(result.data.positions[0]?.symbol).toBe("AAPL");
    }
  });

  it("returns an empty positions array when no rows match", async () => {
    const result = await positionSnapshot(
      { strategy: "no-such-strategy" },
      makeCtx(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.positions).toEqual([]);
    }
  });
});
