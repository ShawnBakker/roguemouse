import type {
  ArgsFor,
  DataFor,
  ToolResult,
} from "@roguemouse/schemas";

import type { ToolCtx } from "../toolCtx.js";

/**
 * Record types reserved for the dispatcher's tool-call lifecycle.
 *
 * The dispatcher in @roguemouse/agent writes `tool:call` and
 * `tool:result` records DIRECTLY via `RunAuditWriter.append`, never
 * through this tool. If a planner mistakenly routes one of these
 * record types through `audit:append`, this guard rejects the call
 * before the writer is touched.
 *
 * See packages/schemas/src/tools/auditAppend.ts JSDoc (the
 * IMPORTANT RECURSION GUARD note) for the architectural rationale.
 */
const RESERVED_RECORDTYPES: ReadonlySet<string> = new Set([
  "tool:call",
  "tool:result",
]);

export async function auditAppend(
  args: ArgsFor<"audit:append">,
  ctx: ToolCtx,
): Promise<ToolResult<DataFor<"audit:append">>> {
  try {
    if (RESERVED_RECORDTYPES.has(args.recordType)) {
      return {
        ok: false,
        error: {
          code: "recordtype_reserved_for_dispatcher",
          message: `recordType '${args.recordType}' is reserved for the dispatcher's tool-call lifecycle. The dispatcher writes these records directly via RunAuditWriter.append; tool implementations must not route them through audit:append. See packages/schemas/src/tools/auditAppend.ts JSDoc for the architectural rationale.`,
          retryable: false,
          step: "validate",
        },
      };
    }

    const writerResult = await ctx.writer.append({
      ts: new Date().toISOString(),
      recordType: args.recordType,
      payload: args.payload,
    } as Parameters<typeof ctx.writer.append>[0]);

    if (!writerResult.ok) {
      return {
        ok: false,
        error: {
          code: writerResult.error.code,
          message: writerResult.error.message,
          retryable: writerResult.error.retryable,
          step: writerResult.error.step,
        },
      };
    }
    return {
      ok: true,
      data: {
        key: writerResult.data.key,
        hash: writerResult.data.hash,
        previousHash: writerResult.data.previousHash,
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
