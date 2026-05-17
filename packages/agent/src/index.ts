export const __packageName = "@roguemouse/agent";

export { createDispatcher, type CreateDispatcherArgs } from "./dispatcher.js";
export type { DispatchTool } from "./dispatchTool.js";

export { detectAnomalies, type Anomaly } from "./anomaly.js";

export {
  OPS_ENGINEER_SYSTEM_PROMPT,
  RISK_OFFICER_SYSTEM_PROMPT,
  SYNTHESIZER_SYSTEM_PROMPT,
} from "./voices/systemPrompts.js";
export { buildRiskOfficerUserPrompt } from "./voices/riskOfficerPrompt.js";
export { buildOpsEngineerUserPrompt } from "./voices/opsEngineerPrompt.js";
export { buildSynthesizerUserPrompt } from "./voices/synthesizerPrompt.js";
export {
  synthesizerResponseSchema,
  type SynthesizerResponse,
} from "./voices/synthesizerResponseSchema.js";
export {
  RISK_OPS_PLACEHOLDER_CONFIDENCE_BP,
  SYNTHESIZER_CONFIDENCE_THRESHOLD_BP,
  parseSynthesizerResponse,
  resolveTerminalDecision,
  type SynthesizerParseResult,
} from "./voices/confidence.js";

export { vultrNemotronPreflight, type PreflightResult } from "./preflight.js";

export {
  runScenarioA,
  type RunScenarioAArgs,
  type ScenarioResult,
  type PerVoiceTiming,
  type PerToolTiming,
} from "./runScenarioA.js";
