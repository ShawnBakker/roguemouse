/**
 * Tool-error envelope. Returned through `ToolResult` whenever a tool
 * dispatch fails. Field set is identical to `@roguemouse/audit`'s
 * `AuditError` (locked in Sprint 2): callers can handle both with
 * the same code path. The `step?` field follows the same convention
 * as `AuditError.step?` — useful when a tool has internal phases
 * (parse args, call API, transform result) and the caller wants
 * forensic visibility into which phase failed.
 */
export type ToolError = {
  code: string;
  message: string;
  retryable: boolean;
  step?: string;
};

/**
 * Discriminated-union envelope returned by every tool dispatch.
 *
 * Sprint 4's dispatch layer (in `@roguemouse/agent`) is contractually
 * required to wrap tool implementations such that no thrown exception
 * escapes the public dispatch surface. If an implementation throws,
 * the dispatcher converts the throw to
 * `{ ok: false, error: { code: "tool_threw", message: <error message>, retryable: false } }`
 * so planner code can rely on the envelope discipline.
 *
 * The same discipline applies to `@roguemouse/inference`
 * (`InferenceResult`) and `@roguemouse/audit` (`AppendResult` /
 * `ReadResult`). One envelope shape for the whole codebase reduces
 * cognitive load: planner code uses `if (result.ok)` everywhere.
 */
export type ToolResult<TData> =
  | { ok: true; data: TData }
  | { ok: false; error: ToolError };
