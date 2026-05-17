import { searchRunbookIndex } from "@roguemouse/runbooks";
import type {
  ArgsFor,
  DataFor,
  ToolResult,
} from "@roguemouse/schemas";

import type { ToolCtx } from "../toolCtx.js";

export async function runbookSearch(
  args: ArgsFor<"runbook:search">,
  ctx: ToolCtx,
): Promise<ToolResult<DataFor<"runbook:search">>> {
  try {
    const matches = searchRunbookIndex(ctx.runbookIndex, args.query, args.topK);
    return { ok: true, data: { matches } };
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
