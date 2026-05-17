import type {
  ArgsFor,
  DataFor,
  ToolResult,
} from "@roguemouse/schemas";

import type { ToolCtx } from "../toolCtx.js";

/**
 * Sprint 4b stub for `policy:check`.
 *
 * Always returns `{ allowed: true, violations: [] }` for any
 * well-formed input. The Scenario A refusal moment is driven by
 * Synthesizer-voice confidence (Sprint 4c), not by policy-engine
 * rejection. Sprint 7 or post-submission can introduce a real
 * rule-based policy engine here.
 *
 * `_args` and `_ctx` are intentionally unused.
 */
export async function policyCheck(
  _args: ArgsFor<"policy:check">,
  _ctx: ToolCtx,
): Promise<ToolResult<DataFor<"policy:check">>> {
  try {
    return {
      ok: true,
      data: {
        allowed: true,
        violations: [],
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
