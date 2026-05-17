import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadScenarioA } from "../loadScenarioA.js";

const VALID_MARKET_DATA = {
  AAPL: {
    spotPrice: 19450,
    impliedVolatility: 1680,
    realizedVolatility: 4000,
    surfaceTs: "2026-05-16T09:31:14.000Z",
  },
};

const VALID_POSITIONS = [
  {
    strategy: "iv-rv-monitor",
    symbol: "AAPL",
    quantity: 100,
    avgEntryPrice: 19200,
    currentPrice: 19450,
    asOf: "2026-05-16T09:31:14.000Z",
  },
];

const VALID_BROKER_POSITIONS = [
  {
    symbol: "AAPL",
    quantity: 100,
    brokerAccountId: "BROKER-001",
    asOf: "2026-05-16T09:31:14.000Z",
  },
];

const VALID_ANOMALY_EVIDENCE = {
  anomalyId: "anom-aapl-iv-rv-20260516-093114",
  symbol: "AAPL",
  metric: "iv_rv_ratio",
  observedValue: 4200,
  lowBoundThreshold: 4500,
  highBoundThreshold: 9500,
  detectedAt: "2026-05-16T09:31:14.000Z",
};

async function writeAllFixtures(
  rootDir: string,
  overrides: Partial<{
    marketData: unknown;
    positions: unknown;
    brokerPositions: unknown;
    anomalyEvidence: unknown;
    omit: Set<string>;
    rawJson: Partial<Record<string, string>>;
  }> = {},
): Promise<void> {
  const dir = path.join(rootDir, "fixtures", "scenario-a");
  await mkdir(dir, { recursive: true });
  const omit = overrides.omit ?? new Set<string>();
  const rawJson = overrides.rawJson ?? {};

  const files: Array<[string, unknown]> = [
    ["market-data.json", overrides.marketData ?? VALID_MARKET_DATA],
    ["positions.json", overrides.positions ?? VALID_POSITIONS],
    ["broker-positions.json", overrides.brokerPositions ?? VALID_BROKER_POSITIONS],
    ["anomaly-evidence.json", overrides.anomalyEvidence ?? VALID_ANOMALY_EVIDENCE],
  ];

  for (const [filename, value] of files) {
    if (omit.has(filename)) continue;
    const content = rawJson[filename] ?? JSON.stringify(value, null, 2);
    await writeFile(path.join(dir, filename), content, "utf-8");
  }
}

describe("loadScenarioA", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "rgm-fixtures-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("loads and returns parsed fixtures on happy path", async () => {
    await writeAllFixtures(tempRoot);

    const result = await loadScenarioA(tempRoot);

    expect(result.marketData.AAPL).toEqual(VALID_MARKET_DATA.AAPL);
    expect(result.positions).toEqual(VALID_POSITIONS);
    expect(result.brokerPositions).toEqual(VALID_BROKER_POSITIONS);
    expect(result.anomalyEvidence).toEqual(VALID_ANOMALY_EVIDENCE);
  });

  it("throws a clear error naming the missing file path", async () => {
    await writeAllFixtures(tempRoot, { omit: new Set(["market-data.json"]) });

    await expect(loadScenarioA(tempRoot)).rejects.toThrow(/market-data\.json/);
    await expect(loadScenarioA(tempRoot)).rejects.toThrow(/not found/);
  });

  it("throws a clear error naming the malformed JSON file", async () => {
    await writeAllFixtures(tempRoot, {
      rawJson: { "positions.json": "[{not valid json" },
    });

    await expect(loadScenarioA(tempRoot)).rejects.toThrow(/positions\.json/);
    await expect(loadScenarioA(tempRoot)).rejects.toThrow(/JSON parse failed/);
  });

  it("throws a clear error naming the file and field for Zod failure", async () => {
    await writeAllFixtures(tempRoot, {
      marketData: {
        AAPL: {
          spotPrice: "not-a-number",
          impliedVolatility: 1680,
          realizedVolatility: 4000,
          surfaceTs: "2026-05-16T09:31:14.000Z",
        },
      },
    });

    await expect(loadScenarioA(tempRoot)).rejects.toThrow(/market-data\.json/);
    await expect(loadScenarioA(tempRoot)).rejects.toThrow(/Zod parse failed/);
    await expect(loadScenarioA(tempRoot)).rejects.toThrow(/spotPrice/);
  });

  it("rejects out-of-range volatility values", async () => {
    await writeAllFixtures(tempRoot, {
      marketData: {
        AAPL: {
          spotPrice: 19450,
          impliedVolatility: 99999,
          realizedVolatility: 4000,
          surfaceTs: "2026-05-16T09:31:14.000Z",
        },
      },
    });

    await expect(loadScenarioA(tempRoot)).rejects.toThrow(/Zod parse failed/);
    await expect(loadScenarioA(tempRoot)).rejects.toThrow(/impliedVolatility/);
  });

  it("rejects malformed ISO timestamp in anomaly evidence", async () => {
    await writeAllFixtures(tempRoot, {
      anomalyEvidence: {
        ...VALID_ANOMALY_EVIDENCE,
        detectedAt: "2026-05-16 09:31:14",
      },
    });

    await expect(loadScenarioA(tempRoot)).rejects.toThrow(/anomaly-evidence\.json/);
    await expect(loadScenarioA(tempRoot)).rejects.toThrow(/detectedAt/);
  });
});
