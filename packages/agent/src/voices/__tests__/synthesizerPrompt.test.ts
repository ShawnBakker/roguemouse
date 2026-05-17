import { describe, expect, it } from "vitest";

import type { Anomaly } from "../../anomaly.js";
import { buildSynthesizerUserPrompt } from "../synthesizerPrompt.js";

const ANOMALY: Anomaly = {
  anomalyType: "iv_rv_ratio_low_bound_breach",
  severity: 10,
  symbol: "AAPL",
  observedRatioBp: 4200,
  thresholdBp: 4500,
  surfaceTs: "2026-05-16T09:31:14.000Z",
  detectedAt: "2026-05-17T00:00:00.000Z",
};

const RISK_REASONING =
  "The IV/RV ratio of 0.42 is below the 0.45 floor, indicating implied volatility has collapsed relative to realized. Exposure risk on AAPL is moderate; the runbook recommends checking for stale data feeds before recommending action.";

const OPS_REASONING =
  "Internal position state shows AAPL 100 shares long under iv-rv-monitor; broker reports the same. No divergence. Audit history shows no prior anomalies. Operational signals are clean.";

describe("buildSynthesizerUserPrompt", () => {
  it("references both upstream reasoning records verbatim", () => {
    const prompt = buildSynthesizerUserPrompt(ANOMALY, RISK_REASONING, OPS_REASONING);
    expect(prompt).toContain("IV/RV ratio of 0.42 is below the 0.45 floor");
    expect(prompt).toContain("AAPL 100 shares long under iv-rv-monitor");
  });

  it("identifies each voice's section explicitly", () => {
    const prompt = buildSynthesizerUserPrompt(ANOMALY, RISK_REASONING, OPS_REASONING);
    expect(prompt).toContain("RISK OFFICER REASONING");
    expect(prompt).toContain("OPERATIONS ENGINEER REASONING");
  });

  it("includes the anomaly summary at the top", () => {
    const prompt = buildSynthesizerUserPrompt(ANOMALY, RISK_REASONING, OPS_REASONING);
    expect(prompt).toContain("iv_rv_ratio_low_bound_breach");
    expect(prompt).toContain("0.4200");
  });

  it("includes the JSON-output decision instruction", () => {
    const prompt = buildSynthesizerUserPrompt(ANOMALY, RISK_REASONING, OPS_REASONING);
    expect(prompt.toLowerCase()).toContain("json");
    expect(prompt).toContain("decision");
  });

  it("includes the 4500 bp threshold reminder", () => {
    const prompt = buildSynthesizerUserPrompt(ANOMALY, RISK_REASONING, OPS_REASONING);
    expect(prompt).toContain("4500");
  });

  it("instructs recommendation grammar (TO a human, not imperative)", () => {
    const prompt = buildSynthesizerUserPrompt(ANOMALY, RISK_REASONING, OPS_REASONING);
    expect(prompt.toLowerCase()).toContain("recommendation to a human");
  });

  it("is a pure function — same inputs produce the same output", () => {
    const a = buildSynthesizerUserPrompt(ANOMALY, RISK_REASONING, OPS_REASONING);
    const b = buildSynthesizerUserPrompt(ANOMALY, RISK_REASONING, OPS_REASONING);
    expect(a).toBe(b);
  });
});
