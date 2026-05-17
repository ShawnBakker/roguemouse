import type {
  ArgsFor,
  DataFor,
  ToolResult,
} from "@roguemouse/schemas";

import type { ToolCtx } from "../toolCtx.js";

export async function marketDataLookup(
  args: ArgsFor<"market_data:lookup">,
  ctx: ToolCtx,
): Promise<ToolResult<DataFor<"market_data:lookup">>> {
  try {
    const entry = ctx.fixtures.marketData[args.symbol];
    if (!entry) {
      return {
        ok: false,
        error: {
          code: "unknown_symbol",
          message: `No fixture data for symbol: ${args.symbol}`,
          retryable: false,
        },
      };
    }
    return { ok: true, data: entry };
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
