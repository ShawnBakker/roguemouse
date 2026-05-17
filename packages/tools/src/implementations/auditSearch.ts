import {
  auditRecordBodySchema,
  type ArgsFor,
  type DataFor,
  type ToolResult,
} from "@roguemouse/schemas";

import type { ToolCtx } from "../toolCtx.js";

/**
 * Searches the audit log for records under one runId, optionally
 * filtered by recordType and/or a since-timestamp lower bound.
 *
 * Single-page semantics (per spec AC-19, AC-33):
 *   - `hasMore` reflects S3's `IsTruncated` for the LIST page, NOT
 *     the post-filter count.
 *   - The tool does not auto-paginate. A caller seeing
 *     `hasMore: true` re-calls with a narrower prefix or accepts
 *     the partial view.
 *
 * Resilience:
 *   - A read failure on an individual key is SKIPPED (not aborted).
 *     The remaining keys are still attempted.
 *   - A record whose JSON parses but fails `auditRecordBodySchema`
 *     validation is also skipped.
 */
export async function auditSearch(
  args: ArgsFor<"audit:search">,
  ctx: ToolCtx,
): Promise<ToolResult<DataFor<"audit:search">>> {
  try {
    const listResult = await ctx.writer.list({
      runIdPrefix: args.runId,
      limit: args.limit,
    });
    if (!listResult.ok) {
      return {
        ok: false,
        error: {
          code: listResult.error.code,
          message: listResult.error.message,
          retryable: listResult.error.retryable,
          step: listResult.error.step,
        },
      };
    }

    const records: DataFor<"audit:search">["records"] = [];
    for (const key of listResult.data.keys) {
      const readResult = await ctx.writer.read(key);
      if (!readResult.ok) continue;
      const parsed = auditRecordBodySchema.safeParse(readResult.data.parsed);
      if (!parsed.success) continue;
      const record = parsed.data;
      if (args.recordType !== undefined && record.recordType !== args.recordType) {
        continue;
      }
      if (args.sinceTs !== undefined && record.ts < args.sinceTs) {
        continue;
      }
      records.push(record);
    }

    return {
      ok: true,
      data: {
        records,
        hasMore: listResult.data.hasMore,
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
