/**
 * Barrel for the tools module of `@roguemouse/schemas`.
 *
 * Exposes: the `defineTool` helper, the eight tool definitions
 * with their args + result-data schemas (each definition is a
 * `ToolDefinition` value), the registry-level types (`ToolName`,
 * `ArgsFor`, `DataFor`, `ToolsRegistry`), the `ToolError` /
 * `ToolResult` envelope types, and the `DispatchTool` type signature
 * (no runtime function; Sprint 4 owns the implementation).
 */

export { defineTool, type ToolDefinition } from "./defineTool.js";

export type { ToolError, ToolResult } from "./toolResult.js";

export type { DispatchTool } from "./dispatchTool.js";

export {
  TOOLS,
  type ArgsFor,
  type DataFor,
  type ToolName,
  type ToolsRegistry,
} from "./registry.js";

export {
  auditAppendArgsSchema,
  auditAppendResultDataSchema,
  auditAppendTool,
  type AuditAppendArgs,
  type AuditAppendResultData,
} from "./auditAppend.js";

export {
  auditSearchArgsSchema,
  auditSearchResultDataSchema,
  auditSearchTool,
  type AuditSearchArgs,
  type AuditSearchResultData,
} from "./auditSearch.js";

export {
  brokerReconcileArgsSchema,
  brokerReconcileResultDataSchema,
  brokerReconcileTool,
  type BrokerReconcileArgs,
  type BrokerReconcileResultData,
} from "./brokerReconcile.js";

export {
  marketDataLookupArgsSchema,
  marketDataLookupResultDataSchema,
  marketDataLookupTool,
  type MarketDataLookupArgs,
  type MarketDataLookupResultData,
} from "./marketDataLookup.js";

export {
  policyCheckArgsSchema,
  policyCheckResultDataSchema,
  policyCheckTool,
  type PolicyCheckArgs,
  type PolicyCheckResultData,
} from "./policyCheck.js";

export {
  positionSnapshotArgsSchema,
  positionSnapshotResultDataSchema,
  positionSnapshotTool,
  type PositionSnapshotArgs,
  type PositionSnapshotResultData,
} from "./positionSnapshot.js";

export {
  runbookSearchArgsSchema,
  runbookSearchResultDataSchema,
  runbookSearchTool,
  type RunbookSearchArgs,
  type RunbookSearchResultData,
} from "./runbookSearch.js";

export {
  scoreExplainArgsSchema,
  scoreExplainResultDataSchema,
  scoreExplainTool,
  type ScoreExplainArgs,
  type ScoreExplainResultData,
} from "./scoreExplain.js";
