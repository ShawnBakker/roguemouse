import type { ScenarioAFixtures } from "@roguemouse/tools";

import { describe, expect, it } from "vitest";

import { detectAnomalies } from "../anomaly.js";

const VALID_TS = "2026-05-16T09:31:14.000Z";
const DETECTED_AT = "2026-05-17T00:00:00.000Z";

function makeFixtures(
  marketData: Record<
    string,
    { spotPrice: number; impliedVolatility: number; realizedVolatility: number; surfaceTs?: string }
  >,
): ScenarioAFixtures {
  const md: ScenarioAFixtures["marketData"] = {};
  for (const [symbol, entry] of Object.entries(marketData)) {
    md[symbol] = {
      spotPrice: entry.spotPrice,
      impliedVolatility: entry.impliedVolatility,
      realizedVolatility: entry.realizedVolatility,
      surfaceTs: entry.surfaceTs ?? VALID_TS,
    };
  }
  return {
    marketData: md,
    positions: [],
    brokerPositions: [],
    anomalyEvidence: {
      anomalyId: "anom-test",
      symbol: "AAPL",
      metric: "iv_rv_ratio",
      observedValue: 4200,
      lowBoundThreshold: 4500,
      highBoundThreshold: 9500,
      detectedAt: VALID_TS,
    },
  };
}

describe("detectAnomalies", () => {
  it("emits a low-bound breach for the clean Scenario A AAPL ratio (0.42)", () => {
    const fixtures = makeFixtures({
      AAPL: { spotPrice: 19450, impliedVolatility: 1680, realizedVolatility: 4000 },
    });
    const result = detectAnomalies(fixtures, DETECTED_AT);
    expect(result).toHaveLength(1);
    expect(result[0]?.anomalyType).toBe("iv_rv_ratio_low_bound_breach");
    expect(result[0]?.symbol).toBe("AAPL");
    expect(result[0]?.observedRatioBp).toBe(4200);
    expect(result[0]?.thresholdBp).toBe(4500);
    expect(result[0]?.detectedAt).toBe(DETECTED_AT);
    expect(result[0]?.surfaceTs).toBe(VALID_TS);
    expect(result[0]?.severity).toBeGreaterThanOrEqual(1);
    expect(result[0]?.severity).toBeLessThanOrEqual(100);
  });

  it("emits a low-bound breach for the degraded Scenario A AAPL ratio (0.44)", () => {
    const fixtures = makeFixtures({
      AAPL: { spotPrice: 19450, impliedVolatility: 1760, realizedVolatility: 4000 },
    });
    const result = detectAnomalies(fixtures, DETECTED_AT);
    expect(result).toHaveLength(1);
    expect(result[0]?.observedRatioBp).toBe(4400);
    expect(result[0]?.thresholdBp).toBe(4500);
  });

  it("emits a high-bound breach when ratio exceeds 0.95", () => {
    const fixtures = makeFixtures({
      AAPL: { spotPrice: 10000, impliedVolatility: 9800, realizedVolatility: 10000 },
    });
    const result = detectAnomalies(fixtures, DETECTED_AT);
    expect(result).toHaveLength(1);
    expect(result[0]?.anomalyType).toBe("iv_rv_ratio_high_bound_breach");
    expect(result[0]?.observedRatioBp).toBe(9800);
    expect(result[0]?.thresholdBp).toBe(9500);
  });

  it("emits no anomaly when the ratio is in-band (0.45 to 0.95)", () => {
    const fixtures = makeFixtures({
      AAPL: { spotPrice: 10000, impliedVolatility: 3000, realizedVolatility: 5000 },
    });
    const result = detectAnomalies(fixtures, DETECTED_AT);
    expect(result).toEqual([]);
  });

  it("emits no anomaly exactly at the low-bound threshold (0.45)", () => {
    const fixtures = makeFixtures({
      AAPL: { spotPrice: 10000, impliedVolatility: 2250, realizedVolatility: 5000 },
    });
    const result = detectAnomalies(fixtures, DETECTED_AT);
    expect(result).toEqual([]);
  });

  it("returns an empty array for empty marketData", () => {
    const fixtures = makeFixtures({});
    const result = detectAnomalies(fixtures, DETECTED_AT);
    expect(result).toEqual([]);
  });

  it("emits one anomaly per breaching symbol when multiple breaches occur", () => {
    const fixtures = makeFixtures({
      AAPL: { spotPrice: 19450, impliedVolatility: 1680, realizedVolatility: 4000 },
      MSFT: { spotPrice: 42100, impliedVolatility: 9800, realizedVolatility: 10000 },
      GOOGL: { spotPrice: 17850, impliedVolatility: 3000, realizedVolatility: 5000 },
    });
    const result = detectAnomalies(fixtures, DETECTED_AT);
    expect(result).toHaveLength(2);
    const symbols = result.map((a) => a.symbol).sort();
    expect(symbols).toEqual(["AAPL", "MSFT"]);
  });

  it("skips entries with realizedVolatility=0 (no divide-by-zero)", () => {
    const fixtures = makeFixtures({
      AAPL: { spotPrice: 10000, impliedVolatility: 1000, realizedVolatility: 0 },
      MSFT: { spotPrice: 10000, impliedVolatility: 1680, realizedVolatility: 4000 },
    });
    const result = detectAnomalies(fixtures, DETECTED_AT);
    expect(result).toHaveLength(1);
    expect(result[0]?.symbol).toBe("MSFT");
  });

  it("severity scales with breach magnitude", () => {
    const small = detectAnomalies(
      makeFixtures({
        AAPL: { spotPrice: 10000, impliedVolatility: 1760, realizedVolatility: 4000 },
      }),
      DETECTED_AT,
    );
    const large = detectAnomalies(
      makeFixtures({
        AAPL: { spotPrice: 10000, impliedVolatility: 100, realizedVolatility: 10000 },
      }),
      DETECTED_AT,
    );
    expect(small[0]?.severity).toBeLessThan(large[0]?.severity ?? 0);
  });
});
