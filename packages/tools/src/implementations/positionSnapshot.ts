import type {
  ArgsFor,
  DataFor,
  ToolResult,
} from "@roguemouse/schemas";

import type { ToolCtx } from "../toolCtx.js";

export async function positionSnapshot(
  args: ArgsFor<"position:snapshot">,
  ctx: ToolCtx,
): Promise<ToolResult<DataFor<"position:snapshot">>> {
  try {
    const filtered = ctx.fixtures.positions.filter((p) => {
      if (args.strategy !== undefined && p.strategy !== args.strategy) {
        return false;
      }
      if (args.symbol !== undefined && p.symbol !== args.symbol) {
        return false;
      }
      return true;
    });
    return { ok: true, data: { positions: filtered } };
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
