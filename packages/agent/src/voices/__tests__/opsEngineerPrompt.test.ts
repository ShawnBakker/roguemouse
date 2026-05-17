import type { DataFor, ToolResult } from "@roguemouse/schemas";

import { describe, expect, it } from "vitest";

import type { Anomaly } from "../../anomaly.js";
import { buildOpsEngineerUserPrompt } from "../opsEngineerPrompt.js";

const ANOMALY: Anomaly = {
  anomalyType: "iv_rv_ratio_low_bound_breach",
  severity: 10,
  symbol: "AAPL",
  observedRatioBp: 4200,
  thresholdBp: 4500,
  surfaceTs: "2026-05-16T09:31:14.000Z",
  detectedAt: "2026-05-17T00:00:00.000Z",
};

const PS_OK: ToolResult<DataFor<"position:snapshot">> = {
  ok: true,
  data: {
    positions: [
      {
        strategy: "iv-rv-monitor",
        symbol: "AAPL",
        quantity: 100,
        avgEntryPrice: 19200,
        currentPrice: 19450,
        asOf: "2026-05-16T09:31:14.000Z",
      },
    ],
  },
};

const BR_OK: ToolResult<DataFor<"broker:reconcile">> = {
  ok: true,
  data: {
    brokerPositions: [
      {
        symbol: "AAPL",
        quantity: 100,
        brokerAccountId: "BROKER-001",
        asOf: "2026-05-16T09:31:14.000Z",
      },
    ],
  },
};

const AS_EMPTY: ToolResult<DataFor<"audit:search">> = {
  ok: true,
  data: { records: [], hasMore: false },
};

const PS_FAIL: ToolResult<DataFor<"position:snapshot">> = {
  ok: false,
  error: { code: "tool_threw_internal", message: "synthetic failure", retryable: false },
};

const AS_HASMORE: ToolResult<DataFor<"audit:search">> = {
  ok: true,
  data: {
    records: [
      {
        ts: "2026-05-15T07:26:03.694Z",
        runId: "old-run-id",
        recordType: "anomaly:detected",
        previousHash: "0".repeat(64),
        payload: { anomalyType: "x", severity: 10, evidence: {}, detectedAt: "2026-05-15T07:26:03.694Z" },
      },
    ],
    hasMore: true,
  },
};

describe("buildOpsEngineerUserPrompt", () => {
  it("includes the anomaly fields verbatim on happy path", () => {
    const prompt = buildOpsEngineerUserPrompt(ANOMALY, PS_OK, BR_OK, AS_EMPTY);
    expect(prompt).toContain("iv_rv_ratio_low_bound_breach");
    expect(prompt).toContain("AAPL");
    expect(prompt).toContain("0.4200");
  });

  it("includes position snapshot fields on happy path", () => {
    const prompt = buildOpsEngineerUserPrompt(ANOMALY, PS_OK, BR_OK, AS_EMPTY);
    expect(prompt).toContain("strategy=iv-rv-monitor");
    expect(prompt).toContain("qty=100");
    expect(prompt).toContain("POSITION SNAPSHOT");
  });

  it("includes broker reconciliation on happy path", () => {
    const prompt = buildOpsEngineerUserPrompt(ANOMALY, PS_OK, BR_OK, AS_EMPTY);
    expect(prompt).toContain("BROKER RECONCILIATION");
    expect(prompt).toContain("brokerQty=100");
    expect(prompt).toContain("BROKER-001");
  });

  it("notes empty audit history context", () => {
    const prompt = buildOpsEngineerUserPrompt(ANOMALY, PS_OK, BR_OK, AS_EMPTY);
    expect(prompt).toContain("no prior anomaly:detected records");
  });

  it("flags partial results when audit:search hasMore is true", () => {
    const prompt = buildOpsEngineerUserPrompt(ANOMALY, PS_OK, BR_OK, AS_HASMORE);
    expect(prompt).toContain("more records exist beyond this page");
  });

  it("embeds tool-failure context for position:snapshot error per AC-36", () => {
    const prompt = buildOpsEngineerUserPrompt(ANOMALY, PS_FAIL, BR_OK, AS_EMPTY);
    expect(prompt).toContain("ERROR");
    expect(prompt).toContain("tool_threw_internal");
    expect(prompt).toContain("synthetic failure");
  });

  it("is a pure function — same inputs produce the same output", () => {
    const a = buildOpsEngineerUserPrompt(ANOMALY, PS_OK, BR_OK, AS_EMPTY);
    const b = buildOpsEngineerUserPrompt(ANOMALY, PS_OK, BR_OK, AS_EMPTY);
    expect(a).toBe(b);
  });
});
