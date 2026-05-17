import type { RunAuditWriter } from "@roguemouse/audit";
import type { RunbookIndex } from "@roguemouse/runbooks";

import type { ScenarioAFixtures } from "./fixtures/scenarioASchema.js";

/**
 * Runtime context passed to every tool implementation. Constructed once
 * per dispatcher (per run) and held in closure, so individual tool
 * invocations are pure with respect to args + ctx.
 *
 *  - `writer`: the RunAuditWriter for the current run. Used directly
 *    by `audit:append` (after the recursion guard) and `audit:search`.
 *    The dispatcher in @roguemouse/agent ALSO holds this writer
 *    reference; the dispatcher writes tool:call / tool:result records
 *    via `writer.append` directly, not through this context.
 *  - `fixtures`: Scenario A data parsed at boot via `loadScenarioA`.
 *  - `runbookIndex`: in-memory keyword index built at boot via
 *    `buildSearchIndex(loadRunbookCorpus(...))`.
 */
export type ToolCtx = {
  writer: RunAuditWriter;
  fixtures: ScenarioAFixtures;
  runbookIndex: RunbookIndex;
};
