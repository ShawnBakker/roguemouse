import { z } from "zod";

import {
  brokerReconcileResultDataSchema,
  marketDataLookupResultDataSchema,
  positionSnapshotResultDataSchema,
} from "@roguemouse/schemas";

const ISO_TIMESTAMP_MS_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export const marketDataFixtureSchema = z.record(
  z.string().min(1),
  marketDataLookupResultDataSchema,
);

export type MarketDataFixture = z.infer<typeof marketDataFixtureSchema>;

export const positionsFixtureSchema =
  positionSnapshotResultDataSchema.shape.positions;

export type PositionsFixture = z.infer<typeof positionsFixtureSchema>;

export const brokerPositionsFixtureSchema =
  brokerReconcileResultDataSchema.shape.brokerPositions;

export type BrokerPositionsFixture = z.infer<typeof brokerPositionsFixtureSchema>;

export const anomalyEvidenceFixtureSchema = z
  .object({
    anomalyId: z.string().min(1),
    symbol: z.string().min(1),
    metric: z.string().min(1),
    observedValue: z.number().int().min(0).max(10000),
    lowBoundThreshold: z.number().int().min(0).max(10000),
    highBoundThreshold: z.number().int().min(0).max(10000),
    detectedAt: z.string().regex(ISO_TIMESTAMP_MS_REGEX),
  })
  .strict();

export type AnomalyEvidenceFixture = z.infer<typeof anomalyEvidenceFixtureSchema>;

export const scenarioAFixturesSchema = z
  .object({
    marketData: marketDataFixtureSchema,
    positions: positionsFixtureSchema,
    brokerPositions: brokerPositionsFixtureSchema,
    anomalyEvidence: anomalyEvidenceFixtureSchema,
  })
  .strict();

export type ScenarioAFixtures = z.infer<typeof scenarioAFixturesSchema>;
