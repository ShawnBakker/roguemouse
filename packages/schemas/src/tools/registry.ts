import type { z } from "zod";

import { auditAppendTool } from "./auditAppend.js";
import { auditSearchTool } from "./auditSearch.js";
import { brokerReconcileTool } from "./brokerReconcile.js";
import { marketDataLookupTool } from "./marketDataLookup.js";
import { policyCheckTool } from "./policyCheck.js";
import { positionSnapshotTool } from "./positionSnapshot.js";
import { runbookSearchTool } from "./runbookSearch.js";
import { scoreExplainTool } from "./scoreExplain.js";

/**
 * The locked registry of 8 agent tools.
 *
 * Keys are camelCase short names used for internal lookup in the
 * registry; the public tool name (the colon-separated string) is
 * carried in each entry's `.name` field and is what flows through
 * `ToolName`, `dispatchTool`, and the audit log.
 *
 * `as const` preserves the literal types of every `.name` field, so
 * `ToolName` resolves to the literal union of the 8 names rather
 * than the widened `string`. This is what makes `ArgsFor<TName>` /
 * `DataFor<TName>` narrow correctly at call sites.
 *
 * Adding or removing a tool is a single edit to this object plus the
 * corresponding tool file — `ToolName`, `ArgsFor`, `DataFor`, and the
 * registry uniqueness invariant all derive automatically.
 */
export const TOOLS = {
  marketDataLookup: marketDataLookupTool,
  runbookSearch: runbookSearchTool,
  positionSnapshot: positionSnapshotTool,
  brokerReconcile: brokerReconcileTool,
  auditAppend: auditAppendTool,
  auditSearch: auditSearchTool,
  scoreExplain: scoreExplainTool,
  policyCheck: policyCheckTool,
} as const;

/**
 * The full type of the `TOOLS` registry, preserving the literal types
 * of each entry's `name`, `argsSchema`, and `resultDataSchema`.
 */
export type ToolsRegistry = typeof TOOLS;

/**
 * Literal union of the 8 locked tool names. Derived from `TOOLS`.
 * Adding or removing a tool changes this type automatically.
 */
export type ToolName = ToolsRegistry[keyof ToolsRegistry]["name"];

/**
 * A type-level lookup from public tool name to the registry entry for
 * that tool. Re-keys the registry from camelCase short names to the
 * colon-separated public names.
 */
type ToolDefinitionsByName = {
  [K in keyof ToolsRegistry as ToolsRegistry[K]["name"]]: ToolsRegistry[K];
};

/**
 * Narrows the args type for a tool from its public name. Used by
 * `dispatchTool<TName>` to constrain the args parameter at the call
 * site. `ArgsFor<"market_data:lookup">` resolves to
 * `{ symbol: string }`; passing a mismatched shape is a compile error.
 */
export type ArgsFor<TName extends ToolName> = z.infer<
  ToolDefinitionsByName[TName]["argsSchema"]
>;

/**
 * Narrows the result-data type for a tool from its public name. Used
 * by `dispatchTool<TName>` to constrain the `data` of the success
 * branch (`{ ok: true, data: DataFor<TName> }`).
 */
export type DataFor<TName extends ToolName> = z.infer<
  ToolDefinitionsByName[TName]["resultDataSchema"]
>;
