export const __packageName = "@roguemouse/tools";

export {
  anomalyEvidenceFixtureSchema,
  brokerPositionsFixtureSchema,
  marketDataFixtureSchema,
  positionsFixtureSchema,
  scenarioAFixturesSchema,
  type AnomalyEvidenceFixture,
  type BrokerPositionsFixture,
  type MarketDataFixture,
  type PositionsFixture,
  type ScenarioAFixtures,
} from "./fixtures/scenarioASchema.js";

export { loadScenarioA } from "./fixtures/loadScenarioA.js";

export type { ToolCtx } from "./toolCtx.js";

export { marketDataLookup } from "./implementations/marketDataLookup.js";
export { runbookSearch } from "./implementations/runbookSearch.js";
export { positionSnapshot } from "./implementations/positionSnapshot.js";
export { brokerReconcile } from "./implementations/brokerReconcile.js";
export { auditAppend } from "./implementations/auditAppend.js";
export { auditSearch } from "./implementations/auditSearch.js";
export { scoreExplain } from "./implementations/scoreExplain.js";
export { policyCheck } from "./implementations/policyCheck.js";

export {
  TOOL_IMPLEMENTATIONS,
  type ToolImplementation,
  type ToolImplementationsRegistry,
} from "./implementations/registry.js";
