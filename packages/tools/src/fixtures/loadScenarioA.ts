import { readFile } from "node:fs/promises";
import path from "node:path";

import type { z, ZodError } from "zod";

import {
  anomalyEvidenceFixtureSchema,
  brokerPositionsFixtureSchema,
  marketDataFixtureSchema,
  positionsFixtureSchema,
  scenarioAFixturesSchema,
  type ScenarioAFixtures,
} from "./scenarioASchema.js";

const DEFAULT_FIXTURES_SUBDIR = path.join("fixtures", "scenario-a");

const MARKET_DATA_FILE = "market-data.json";
const POSITIONS_FILE = "positions.json";
const BROKER_POSITIONS_FILE = "broker-positions.json";
const ANOMALY_EVIDENCE_FILE = "anomaly-evidence.json";

function formatZodError(filePath: string, err: ZodError): string {
  const issues = err.issues
    .map((iss) => `  - ${iss.path.join(".") || "<root>"}: ${iss.message}`)
    .join("\n");
  return `Fixture Zod parse failed: ${filePath}\n${issues}`;
}

async function readAndParseJson(filePath: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new Error(`Fixture file not found: ${filePath}`);
    }
    throw new Error(
      `Fixture file read failed: ${filePath} — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Fixture JSON parse failed: ${filePath} — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function safeParse<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
  filePath: string,
): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(formatZodError(filePath, result.error));
  }
  return result.data;
}

/**
 * Load the Scenario A fixture set from disk and Zod-parse each of the
 * four JSON files.
 *
 *  - `rootDir`: usually the repo root (e.g., `process.cwd()` from a
 *    script invocation).
 *  - `subdir`: optional override of the fixtures subdirectory.
 *    Defaults to `"fixtures/scenario-a"`. Sprint 4c's `--degraded`
 *    flag passes `"fixtures/scenario-a-degraded"` to load the
 *    semantically-uncertain fixture set without changing the loader's
 *    parsing logic.
 *
 * Zod failures, missing files, and malformed JSON all throw clear
 * errors naming the offending path.
 */
export async function loadScenarioA(
  rootDir: string,
  subdir: string = DEFAULT_FIXTURES_SUBDIR,
): Promise<ScenarioAFixtures> {
  const dir = path.join(rootDir, subdir);

  const marketDataPath = path.join(dir, MARKET_DATA_FILE);
  const positionsPath = path.join(dir, POSITIONS_FILE);
  const brokerPositionsPath = path.join(dir, BROKER_POSITIONS_FILE);
  const anomalyEvidencePath = path.join(dir, ANOMALY_EVIDENCE_FILE);

  const [marketDataRaw, positionsRaw, brokerPositionsRaw, anomalyEvidenceRaw] =
    await Promise.all([
      readAndParseJson(marketDataPath),
      readAndParseJson(positionsPath),
      readAndParseJson(brokerPositionsPath),
      readAndParseJson(anomalyEvidencePath),
    ]);

  const marketData = safeParse(marketDataFixtureSchema, marketDataRaw, marketDataPath);
  const positions = safeParse(positionsFixtureSchema, positionsRaw, positionsPath);
  const brokerPositions = safeParse(
    brokerPositionsFixtureSchema,
    brokerPositionsRaw,
    brokerPositionsPath,
  );
  const anomalyEvidence = safeParse(
    anomalyEvidenceFixtureSchema,
    anomalyEvidenceRaw,
    anomalyEvidencePath,
  );

  return safeParse(
    scenarioAFixturesSchema,
    { marketData, positions, brokerPositions, anomalyEvidence },
    dir,
  );
}
