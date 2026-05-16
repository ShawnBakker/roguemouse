import type { z } from "zod";

/**
 * The shape of a single tool's contract: a name (literal-preserved
 * across the generic), an args schema, and a result-data schema.
 *
 * The result-data schema describes the payload of the success branch
 * of `ToolResult<TData>`; it does NOT describe the full envelope. The
 * error branch is uniform across all tools and is not redefined per
 * tool (see `ToolError` in `./toolResult.js`).
 *
 * `TName` is preserved as a string literal so the registry's
 * `ToolName` derivation produces a literal union, not the widened
 * `string`. This is what makes call-site type narrowing work in
 * `dispatchTool<TName>`.
 *
 * AC-24a (contract): tool implementations (Sprint 4) are required not
 * to throw on their public dispatch surface. Implementations that
 * throw will be caught by Sprint 4's dispatch wrapping logic and
 * converted to `{ ok: false, error: { code: "tool_threw", ... } }`
 * envelopes.
 */
export interface ToolDefinition<TName extends string, TArgs, TData> {
  readonly name: TName;
  readonly argsSchema: z.ZodType<TArgs>;
  readonly resultDataSchema: z.ZodType<TData>;
}

/**
 * Construct a tool definition. Each of the 8 locked tools is defined
 * by exactly one call to this helper, in its own file under
 * `tools/<toolShortName>.ts`.
 *
 * The helper's only job is to preserve the literal type of `name` and
 * the args + result types of the supplied schemas. There is no runtime
 * dispatch logic here — that's Sprint 4's responsibility in
 * `@roguemouse/agent`.
 *
 * AC-24a (contract): the tool implementation that consumes this
 * definition is required not to throw on its public dispatch surface.
 * The dispatch wrapping logic (Sprint 4) converts any thrown exception
 * to `{ ok: false, error: { code: "tool_threw", ... } }`.
 *
 * @param name - the public tool name (colon-separated literal, e.g.
 *               `"market_data:lookup"`)
 * @param argsSchema - Zod schema for the tool's input args (must be
 *                     a `.strict()` object so extras are rejected)
 * @param resultDataSchema - Zod schema for the tool's success payload
 *                           (the `data` of `{ ok: true, data }`)
 */
export function defineTool<TName extends string, TArgs, TData>(
  name: TName,
  argsSchema: z.ZodType<TArgs>,
  resultDataSchema: z.ZodType<TData>,
): ToolDefinition<TName, TArgs, TData> {
  return { name, argsSchema, resultDataSchema };
}
