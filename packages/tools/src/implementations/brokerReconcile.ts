import type {
  ArgsFor,
  DataFor,
  ToolResult,
} from "@roguemouse/schemas";

import type { ToolCtx } from "../toolCtx.js";

/**
 * Reconciles broker-reported positions against internal positions
 * for a given strategy.
 *
 * The Sprint 3 schema accepts { strategy } but broker positions
 * are per-symbol-per-account (the broker doesn't know about our
 * internal strategy concept). This implementation:
 *
 * 1. Reads ctx.fixtures.positions to find symbols associated
 *    with the requested strategy
 * 2. Filters ctx.fixtures.brokerPositions to those symbols
 * 3. Returns the broker's view of those positions
 *
 * The reconciliation flow's purpose is to detect divergence
 * between what we (the system) think we hold vs what the broker
 * says we hold. Strategy is our internal concept; the broker is
 * strategy-agnostic.
 */
export async function brokerReconcile(
  args: ArgsFor<"broker:reconcile">,
  ctx: ToolCtx,
): Promise<ToolResult<DataFor<"broker:reconcile">>> {
  try {
    const symbolsForStrategy = new Set(
      ctx.fixtures.positions
        .filter((p) => p.strategy === args.strategy)
        .map((p) => p.symbol),
    );
    const brokerPositions = ctx.fixtures.brokerPositions.filter((b) =>
      symbolsForStrategy.has(b.symbol),
    );
    return { ok: true, data: { brokerPositions } };
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
