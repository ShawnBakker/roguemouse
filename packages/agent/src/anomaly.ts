import type { ScenarioAFixtures } from "@roguemouse/tools";

/**
 * One detected anomaly produced by `detectAnomalies`. The shape is
 * shaped to populate the locked Sprint 3 `anomalyDetectedPayload`
 * schema (anomalyType, severity, evidence, detectedAt) — the runner
 * remaps these fields into the payload at write time.
 *
 *  - `severity`: int 1-100 derived from the magnitude of the breach
 *    (clampSeverity below).
 *  - `observedRatioBp` / `thresholdBp`: integer basis points 0-10000
 *    (e.g., a ratio of 0.42 is 4200 bp).
 *  - `surfaceTs`: the market-data fixture's timestamp; ISO ms format.
 *  - `detectedAt`: runner-supplied ISO ms timestamp at detection time.
 */
export type Anomaly = {
  anomalyType: string;
  severity: number;
  symbol: string;
  observedRatioBp: number;
  thresholdBp: number;
  surfaceTs: string;
  detectedAt: string;
};

/** IV/RV ratio low-bound threshold in basis points (= 0.45 ratio). */
const LOW_BOUND_BP = 4500;

/** IV/RV ratio high-bound threshold in basis points (= 0.95 ratio). */
const HIGH_BOUND_BP = 9500;

/**
 * Map a basis-point breach magnitude to a severity 1-100. 10 bp per
 * severity step. The clean Scenario A AAPL breach (300 bp, ratio 0.42
 * vs 0.45 floor) produces severity 30 — a meaningful but not critical
 * regime signal. The degraded variant (100 bp, ratio 0.44 vs 0.45)
 * produces severity 10 — borderline. Breaches above 1000 bp clamp to
 * severity 100. Recalibrated in Sprint 4c Phase 8 from divisor 30 to
 * 10 after the original calibration was found to undersell real
 * significance (IV/RV ratio 0.42 vs 0.45 floor is a meaningful
 * options-market dislocation, not severity 10/100).
 */
function clampSeverity(breachMagnitudeBp: number): number {
  const scaled = Math.round(breachMagnitudeBp / 10);
  return Math.min(100, Math.max(1, scaled));
}

/**
 * Scan a Scenario A fixture set for IV/RV ratio breaches.
 *
 * Returns one `Anomaly` per market-data entry whose ratio falls
 * outside the locked band [4500, 9500] bp (equivalent to ratio
 * 0.45 to 0.95). Returns `[]` for fixture sets with no breaches.
 * Never throws.
 *
 * Defensive: an entry with `realizedVolatility === 0` is skipped
 * (no divide-by-zero); the schema bounds make this rare but the
 * guard keeps the detector total.
 *
 * Sprint 4c invokes the detector once per `runScenarioA` call and
 * processes only the first emitted anomaly (per spec out-of-scope:
 * multiple anomalies per run). The `Anomaly[]` return shape is for
 * extensibility (Sprint 5's Scenarios B/C may consume multiple).
 */
export function detectAnomalies(
  fixtures: ScenarioAFixtures,
  detectedAt: string,
): Anomaly[] {
  const results: Anomaly[] = [];
  for (const [symbol, md] of Object.entries(fixtures.marketData)) {
    if (md.realizedVolatility === 0) continue;
    const ratioBp = Math.round(
      (md.impliedVolatility / md.realizedVolatility) * 10000,
    );
    if (ratioBp < LOW_BOUND_BP) {
      results.push({
        anomalyType: "iv_rv_ratio_low_bound_breach",
        severity: clampSeverity(LOW_BOUND_BP - ratioBp),
        symbol,
        observedRatioBp: ratioBp,
        thresholdBp: LOW_BOUND_BP,
        surfaceTs: md.surfaceTs,
        detectedAt,
      });
    } else if (ratioBp > HIGH_BOUND_BP) {
      results.push({
        anomalyType: "iv_rv_ratio_high_bound_breach",
        severity: clampSeverity(ratioBp - HIGH_BOUND_BP),
        symbol,
        observedRatioBp: ratioBp,
        thresholdBp: HIGH_BOUND_BP,
        surfaceTs: md.surfaceTs,
        detectedAt,
      });
    }
  }
  return results;
}
