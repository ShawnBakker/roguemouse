import { validateCanonicalSafe } from "./canonicalSafe.js";

/**
 * Produce a canonical JSON serialization of a value, suitable for hashing.
 *
 * The canonical form is produced by recursively sorting object keys in
 * lexicographic byte order, then serializing via `JSON.stringify` with no
 * whitespace. Two structurally-equal values produce byte-identical canonical
 * strings; any structural difference produces distinct canonical strings.
 * The canonical form is what gets hashed in the audit log; the pretty-printed
 * form is never hashed.
 *
 * Input constraints (enforced before serialization; violations throw):
 *
 *  - Plain objects with string keys, arrays, strings (UTF-8), booleans, and
 *    null are accepted.
 *  - Numbers must be integers within the safe-integer range
 *    (Number.MIN_SAFE_INTEGER <= n <= Number.MAX_SAFE_INTEGER). The rule is
 *    no floats — JavaScript's default float serialization is not stable
 *    across engines for all values, and the audit log hash must be
 *    reproducible.
 *  - NaN, Infinity, -Infinity, undefined, functions, symbols, BigInt, Date /
 *    Map / Set instances, and any non-plain object are rejected.
 *  - Strings are accepted as-is. No UTF-8 normalization (NFC) is performed
 *    at this layer; callers are responsible for ensuring inputs are already
 *    in their intended Unicode normalization form if byte-level string
 *    equality matters.
 *
 * On invalid input the function throws an `Error` naming the first offending
 * field or value. Rejection occurs before any serialization, so a value that
 * would produce an unreproducible hash is never minted into an audit record.
 *
 * Deferred migration: if a payload ever needs to hash non-integer numbers,
 * non-NFC Unicode, or other values where this rolled-own canonicalizer would
 * diverge from the JCS spec, swap in an MIT-licensed RFC 8785 implementation.
 * The migration trigger is tracked in `tasks/todo.md`.
 *
 * Validation is delegated to `@roguemouse/schemas` (`validateCanonicalSafe`)
 * so that the rules are defined once and used both at parse boundaries (via
 * the Zod schema) and at hash time (here).
 *
 * @param value - The JSON-safe value to canonicalize.
 * @returns The canonical JSON string (no whitespace, sorted keys).
 * @throws Error if `value` fails the input constraints above.
 */
export function canonicalize(value: unknown): string {
  const check = validateCanonicalSafe(value);
  if (!check.ok) {
    throw new Error(`canonicalize: ${check.error}`);
  }
  return JSON.stringify(toCanonical(value));
}

/**
 * Recursively transform a validated value into a key-sorted plain structure
 * suitable for `JSON.stringify`. Assumes input has already passed
 * `validateCanonicalSafe`; does no validation of its own.
 */
function toCanonical(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value;

  if (Array.isArray(value)) {
    return value.map((v) => toCanonical(v));
  }

  const entries = Object.entries(value as Record<string, unknown>);
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const out: Record<string, unknown> = {};
  for (const [k, v] of entries) {
    out[k] = toCanonical(v);
  }
  return out;
}
