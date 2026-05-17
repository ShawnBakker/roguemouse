import type {
  ArgsFor,
  DataFor,
  ToolName,
  ToolResult,
} from "@roguemouse/schemas";

import type { ToolCtx } from "../toolCtx.js";
import { auditAppend } from "./auditAppend.js";
import { auditSearch } from "./auditSearch.js";
import { brokerReconcile } from "./brokerReconcile.js";
import { marketDataLookup } from "./marketDataLookup.js";
import { policyCheck } from "./policyCheck.js";
import { positionSnapshot } from "./positionSnapshot.js";
import { runbookSearch } from "./runbookSearch.js";
import { scoreExplain } from "./scoreExplain.js";

/**
 * Type for a single tool implementation function: takes the narrow
 * args for `TName`, the runtime ctx, and returns a Promise resolving
 * to the narrow ToolResult for `TName`.
 */
export type ToolImplementation<TName extends ToolName> = (
  args: ArgsFor<TName>,
  ctx: ToolCtx,
) => Promise<ToolResult<DataFor<TName>>>;

/**
 * Mapped type enforcing per-name implementation coverage. Adding or
 * removing a name in @roguemouse/schemas's ToolName produces a
 * type error here until the registry below is updated to match.
 */
export type ToolImplementationsRegistry = {
  [K in ToolName]: ToolImplementation<K>;
};

/**
 * The locked Sprint 4b registry of 8 tool implementations.
 *
 * The `satisfies` clause validates per-name function shape (every
 * ToolName has an implementation matching its narrow signature)
 * WITHOUT widening the inferred property types. A plain `:
 * ToolImplementationsRegistry` annotation would widen each property
 * to `ToolImplementation<ToolName>` (the union), losing the
 * narrow-by-key precision needed when downstream code looks up an
 * implementation by a specific name.
 *
 * The dispatcher in @roguemouse/agent looks up implementations by
 * name; that lookup uses a narrowing cast (since the union-of-
 * narrow-functions vs narrow-of-union-functions has variance
 * issues that TypeScript cannot resolve from a parameterized
 * lookup). Phase 5 owns that detail.
 */
export const TOOL_IMPLEMENTATIONS = {
  "market_data:lookup": marketDataLookup,
  "runbook:search": runbookSearch,
  "position:snapshot": positionSnapshot,
  "broker:reconcile": brokerReconcile,
  "audit:append": auditAppend,
  "audit:search": auditSearch,
  "score:explain": scoreExplain,
  "policy:check": policyCheck,
} satisfies ToolImplementationsRegistry;
