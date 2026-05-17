import type {
  ArgsFor,
  DataFor,
  ToolResult,
} from "@roguemouse/schemas";

import type { ToolCtx } from "../toolCtx.js";

/**
 * Sprint 4b stub for `score:explain`.
 *
 * Returns a schema-valid envelope with deterministic inline-constant
 * components and a narrative that echoes the caller's args. Sprint 4b
 * does not exercise this tool in Scenario A; Sprint 7 or post-
 * submission can replace this stub with real scoring-component
 * extraction once a scoring model is wired up.
 *
 * `_ctx` is intentionally unused — the stub does not consult fixtures
 * or any other runtime state.
 */
export async function scoreExplain(
  args: ArgsFor<"score:explain">,
  _ctx: ToolCtx,
): Promise<ToolResult<DataFor<"score:explain">>> {
  try {
    return {
      ok: true,
      data: {
        components: [
          { name: "iv_rv_breach", contribution: 60, weight: 6000 },
          { name: "position_size", contribution: 25, weight: 2500 },
          { name: "historical_pattern", contribution: 15, weight: 1500 },
        ],
        narrative: `Stub explanation for strategy '${args.strategy}' with scoreValue ${args.scoreValue}. Components and weights are deterministic Sprint 4b fixtures, not derived from a real scoring model.`,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "tool_threw_internal",
        message: err instanceof Error ? err.message : String(err),
        retryable: false,
      },
    };
  }
}
