import type { DataFor, ToolResult } from "@roguemouse/schemas";

import { describe, expect, it } from "vitest";

import type { Anomaly } from "../../anomaly.js";
import { buildRiskOfficerUserPrompt } from "../riskOfficerPrompt.js";

const ANOMALY: Anomaly = {
  anomalyType: "iv_rv_ratio_low_bound_breach",
  severity: 10,
  symbol: "AAPL",
  observedRatioBp: 4200,
  thresholdBp: 4500,
  surfaceTs: "2026-05-16T09:31:14.000Z",
  detectedAt: "2026-05-17T00:00:00.000Z",
};

const MD_OK: ToolResult<DataFor<"market_data:lookup">> = {
  ok: true,
  data: {
    spotPrice: 19450,
    impliedVolatility: 1680,
    realizedVolatility: 4000,
    surfaceTs: "2026-05-16T09:31:14.000Z",
  },
};

const RB_OK: ToolResult<DataFor<"runbook:search">> = {
  ok: true,
  data: {
    matches: [
      {
        path: "packages/runbooks/content/iv-rv-divergence.md",
        excerpt: "Triggers when IV/RV ratio breaches thresholds.",
        relevanceScore: 476,
      },
    ],
  },
};

const MD_FAIL: ToolResult<DataFor<"market_data:lookup">> = {
  ok: false,
  error: { code: "unknown_symbol", message: "no fixture for symbol", retryable: false },
};

const RB_EMPTY: ToolResult<DataFor<"runbook:search">> = {
  ok: true,
  data: { matches: [] },
};

describe("buildRiskOfficerUserPrompt", () => {
  it("includes the anomaly fields verbatim on happy path", () => {
    const prompt = buildRiskOfficerUserPrompt(ANOMALY, MD_OK, RB_OK);
    expect(prompt).toContain("iv_rv_ratio_low_bound_breach");
    expect(prompt).toContain("AAPL");
    expect(prompt).toContain("0.4200"); // observedRatioBp / 10000 formatted
    expect(prompt).toContain("0.4500"); // thresholdBp / 10000 formatted
    expect(prompt).toContain("2026-05-16T09:31:14.000Z");
  });

  it("includes market-data tool result on happy path", () => {
    const prompt = buildRiskOfficerUserPrompt(ANOMALY, MD_OK, RB_OK);
    expect(prompt).toContain("19450");
    expect(prompt).toContain("1680");
    expect(prompt).toContain("4000");
    expect(prompt).toContain("MARKET DATA LOOKUP");
  });

  it("includes runbook-search top match on happy path", () => {
    const prompt = buildRiskOfficerUserPrompt(ANOMALY, MD_OK, RB_OK);
    expect(prompt).toContain("iv-rv-divergence.md");
    expect(prompt).toContain("476");
    expect(prompt).toContain("RUNBOOK SEARCH");
  });

  it("embeds tool-failure context for market-data error per AC-36", () => {
    const prompt = buildRiskOfficerUserPrompt(ANOMALY, MD_FAIL, RB_OK);
    expect(prompt).toContain("ERROR");
    expect(prompt).toContain("unknown_symbol");
    expect(prompt).toContain("no fixture for symbol");
  });

  it("handles empty runbook matches gracefully", () => {
    const prompt = buildRiskOfficerUserPrompt(ANOMALY, MD_OK, RB_EMPTY);
    expect(prompt).toContain("no runbook matches returned");
  });

  it("is a pure function — same inputs produce the same output", () => {
    const a = buildRiskOfficerUserPrompt(ANOMALY, MD_OK, RB_OK);
    const b = buildRiskOfficerUserPrompt(ANOMALY, MD_OK, RB_OK);
    expect(a).toBe(b);
  });
});
