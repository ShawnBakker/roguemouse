/**
 * Leaf module for validation primitives that multiple sibling modules
 * need (envelope regexes, tool-name literal array).
 *
 * IMPORTANT — DO NOT add cross-sibling imports here. This file must
 * have NO relative imports from parent or sibling paths. Only the
 * standard library and `zod` are acceptable dependencies. Adding a
 * sibling import would re-create the circular module graph this file
 * exists to break (`auditRecord.ts ↔ auditPayloads.ts`, plus the
 * `tools/* → auditRecord.ts` chain).
 *
 * Owners:
 *  - `ISO_TIMESTAMP_MS_REGEX` and `HEX_64_REGEX`: used by the audit
 *    envelope schema and by Phase 3 tool schemas with timestamp /
 *    hash fields.
 *  - `TOOL_NAME_LITERALS` and `ToolNameLiteral`: the single source
 *    of truth for the 8 tool name strings. `tools/registry.ts`
 *    derives `ToolName` from the `TOOLS` map's `.name` fields (which
 *    are hardcoded literals in each tool file); a type-level test
 *    in `tools/registry.test.ts` asserts `ToolName === ToolNameLiteral`,
 *    so drift between the hardcoded `.name` fields and this array is
 *    caught at compile time.
 */

/**
 * Regex for ISO-8601 UTC timestamps at millisecond precision (e.g.
 * `2026-05-15T07:26:03.694Z`). Used by the audit envelope schema's
 * `ts` field and by every tool schema field carrying a timestamp.
 */
export const ISO_TIMESTAMP_MS_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Regex for 64-character lowercase hexadecimal strings. Used by the
 * audit envelope schema's `previousHash` field and by tool schemas
 * that carry SHA-256 hashes.
 */
export const HEX_64_REGEX = /^[0-9a-f]{64}$/;

/**
 * Literal array of the 8 locked tool names, in registry order. Single
 * source of truth: `tools/registry.ts` and `auditPayloads.ts` both
 * reference this array (the latter via `z.enum(TOOL_NAME_LITERALS)`
 * for the `tool:call` / `tool:result` payload's `toolName` field).
 *
 * Each tool file's `defineTool(<literal>, ...)` call hardcodes a name
 * that must match one of these literals; the equality is enforced
 * by the type-level test in `tools/registry.test.ts`
 * (`Equal<ToolName, ToolNameLiteral>`).
 */
export const TOOL_NAME_LITERALS = [
  "market_data:lookup",
  "runbook:search",
  "position:snapshot",
  "broker:reconcile",
  "audit:append",
  "audit:search",
  "score:explain",
  "policy:check",
] as const;

/**
 * Literal union of the 8 locked tool names. Derived from
 * `TOOL_NAME_LITERALS`. Adding or removing a name in the array
 * changes this type automatically.
 */
export type ToolNameLiteral = (typeof TOOL_NAME_LITERALS)[number];
