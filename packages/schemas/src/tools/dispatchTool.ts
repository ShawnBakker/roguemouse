import type { ArgsFor, DataFor, ToolName } from "./registry.js";
import type { ToolResult } from "./toolResult.js";

/**
 * Type signature for the planner's tool dispatch function.
 *
 * IMPORTANT: this file exports a TYPE only. The runtime implementation
 * of dispatch lives in `@roguemouse/agent` (Sprint 4), not here.
 * Sprint 3 locks the contract; Sprint 4 wires up the machinery.
 *
 * The return type is `Promise<ToolResult<DataFor<TName>>>` — always
 * the envelope-wrapped type, never the raw data. A Sprint 4
 * implementation that returned raw `DataFor<TName>` without the
 * envelope would be a compile-time error at the call site. This
 * enforces AC-24b.
 *
 * The `TName extends ToolName` generic narrows `args` to
 * `ArgsFor<TName>` and the result's `data` to `DataFor<TName>` at
 * compile time. Calling
 *   `dispatchTool("market_data:lookup", { symbol: "AAPL" })`
 * gives a return type of
 *   `Promise<ToolResult<MarketDataLookupResultData>>`,
 * narrowed automatically from the registry lookup — no per-tool
 * switch needed at the call site.
 *
 * AC-24a (contract on the implementation Sprint 4 will write): the
 * dispatcher wraps each tool implementation so that any thrown
 * exception is caught and converted to
 * `{ ok: false, error: { code: "tool_threw", message, retryable: false } }`.
 * Tool implementations themselves are required not to throw on their
 * public surface; the dispatcher's wrap is the defense-in-depth
 * fallback.
 *
 * See `defineTool` and `TOOLS` for the contract that this type
 * consumes.
 */
export type DispatchTool = <TName extends ToolName>(
  name: TName,
  args: ArgsFor<TName>,
) => Promise<ToolResult<DataFor<TName>>>;
