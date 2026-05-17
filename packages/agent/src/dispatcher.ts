import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import type { AppendInput, RunAuditWriter } from "@roguemouse/audit";
import type {
  ArgsFor,
  DataFor,
  DispatchTool,
  ToolName,
  ToolResult,
} from "@roguemouse/schemas";
import {
  TOOL_IMPLEMENTATIONS,
  type ToolCtx,
  type ToolImplementation,
} from "@roguemouse/tools";

export type CreateDispatcherArgs = {
  writer: RunAuditWriter;
  fixtures: ToolCtx["fixtures"];
  runbookIndex: ToolCtx["runbookIndex"];
};

/**
 * Construct a serial `dispatchTool` function bound to a single
 * RunAuditWriter (one run).
 *
 * Per-dispatch lifecycle:
 *   1. Generate invocationId (UUIDv4).
 *   2. Write a `tool:call` audit record DIRECTLY via writer.append
 *      (architectural recursion guard, AC-12).
 *   3. Execute the tool's implementation (defensive try/catch wraps
 *      the call in case the implementation throws despite contract).
 *   4. Time the body via performance.now().
 *   5. Write a `tool:result` audit record DIRECTLY via writer.append.
 *   6. Return the implementation's envelope.
 *
 * Serial mutex: a promise-chain ensures invocations execute one at a
 * time within a single dispatcher instance, even if the caller fires
 * multiple dispatch invocations in parallel. Chain ordering on
 * the audit log is therefore deterministic. Parallel dispatch with
 * a write-queue is deferred to Sprint 7 polish (see tasks/todo.md).
 */
export function createDispatcher(args: CreateDispatcherArgs): DispatchTool {
  const ctx: ToolCtx = {
    writer: args.writer,
    fixtures: args.fixtures,
    runbookIndex: args.runbookIndex,
  };

  let mutex: Promise<unknown> = Promise.resolve();

  const dispatchTool: DispatchTool = async <TName extends ToolName>(
    name: TName,
    a: ArgsFor<TName>,
  ): Promise<ToolResult<DataFor<TName>>> => {
    const prior = mutex;
    let release: () => void = () => {};
    mutex = new Promise<void>((r) => {
      release = r;
    });
    try {
      await prior;
      return await runOne(name, a, ctx);
    } finally {
      release();
    }
  };

  return dispatchTool;
}

async function runOne<TName extends ToolName>(
  name: TName,
  a: ArgsFor<TName>,
  ctx: ToolCtx,
): Promise<ToolResult<DataFor<TName>>> {
  const invocationId = randomUUID();

  // tool:call audit write (direct, NOT via the audit:append tool)
  const callPayload = {
    toolName: name,
    invocationId,
    args: a as unknown,
  };
  const callWrite = await ctx.writer.append({
    ts: new Date().toISOString(),
    recordType: "tool:call",
    payload: callPayload,
  } as AppendInput);
  if (!callWrite.ok) {
    return {
      ok: false,
      error: {
        code: "audit_write_failed",
        message: callWrite.error.message,
        retryable: callWrite.error.retryable,
        step: "tool_call_audit",
      },
    } satisfies ToolResult<DataFor<TName>>;
  }

  // Execute the implementation with defensive try/catch.
  const start = performance.now();
  let result: ToolResult<DataFor<TName>>;
  try {
    const impl = TOOL_IMPLEMENTATIONS[name] as ToolImplementation<TName> | undefined;
    if (!impl) {
      result = {
        ok: false,
        error: {
          code: "unknown_tool",
          message: `No implementation registered for tool name: ${name}`,
          retryable: false,
        },
      } satisfies ToolResult<DataFor<TName>>;
    } else {
      result = await impl(a, ctx);
    }
  } catch (err) {
    result = {
      ok: false,
      error: {
        code: "tool_threw",
        message: err instanceof Error ? err.message : String(err),
        retryable: false,
      },
    } satisfies ToolResult<DataFor<TName>>;
  }
  const durationMs = Math.max(0, Math.round(performance.now() - start));

  // tool:result audit write (direct, NOT via the audit:append tool)
  const resultPayload = {
    toolName: name,
    invocationId,
    result: result as unknown,
    durationMs,
  };
  const resultWrite = await ctx.writer.append({
    ts: new Date().toISOString(),
    recordType: "tool:result",
    payload: resultPayload,
  } as AppendInput);
  if (!resultWrite.ok) {
    return {
      ok: false,
      error: {
        code: "audit_write_failed",
        message: resultWrite.error.message,
        retryable: resultWrite.error.retryable,
        step: "tool_result_audit",
      },
    } satisfies ToolResult<DataFor<TName>>;
  }

  return result;
}
