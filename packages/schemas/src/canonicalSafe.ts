import { z } from "zod";

/**
 * Result of a canonicalization-safety check.
 *
 * On success `{ ok: true }`. On failure `{ ok: false, error }` where `error`
 * is a single-line string naming the first offending field or value and the
 * reason it was rejected. The error message uses dot-notation for object
 * properties and bracket notation for array indices, so a caller can locate
 * the bad value in a deeply nested structure.
 */
export type CanonicalSafeCheck = { ok: true } | { ok: false; error: string };

/**
 * Walk a value depth-first and return the first canonicalization-safety
 * violation encountered, or `null` if every reachable node is safe.
 *
 * Internal helper. Public callers use `validateCanonicalSafe` or
 * `canonicalSafeSchema`.
 */
function checkCanonicalSafe(value: unknown, path: string = ""): string | null {
  const here = path || "value";

  if (value === null) return null;
  if (typeof value === "boolean") return null;
  if (typeof value === "string") return null;

  if (typeof value === "number") {
    if (Number.isNaN(value)) return `${here} is NaN`;
    if (!Number.isFinite(value)) {
      return `${here} is ${value > 0 ? "Infinity" : "-Infinity"}`;
    }
    if (!Number.isInteger(value)) {
      return `${here} is a non-integer number (${value})`;
    }
    if (value < Number.MIN_SAFE_INTEGER || value > Number.MAX_SAFE_INTEGER) {
      return `${here} is an integer outside the safe range (${value})`;
    }
    return null;
  }

  if (typeof value === "undefined") return `${here} is undefined`;
  if (typeof value === "function") return `${here} is a function`;
  if (typeof value === "symbol") return `${here} is a symbol`;
  if (typeof value === "bigint") return `${here} is a BigInt`;

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const childErr = checkCanonicalSafe(value[i], `${path}[${i}]`);
      if (childErr) return childErr;
    }
    return null;
  }

  if (typeof value === "object") {
    if (value instanceof Date) return `${here} is a Date instance`;
    if (value instanceof Map) return `${here} is a Map instance`;
    if (value instanceof Set) return `${here} is a Set instance`;

    const proto = Object.getPrototypeOf(value);
    if (proto !== null && proto !== Object.prototype) {
      const ctorName =
        (value as { constructor?: { name?: string } }).constructor?.name ?? "unknown";
      return `${here} is a non-plain object (constructor: ${ctorName})`;
    }

    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const childErr = checkCanonicalSafe(v, path ? `${path}.${k}` : k);
      if (childErr) return childErr;
    }
    return null;
  }

  return `${here} is of unsupported type (${typeof value})`;
}

/**
 * Validate that a value is canonicalization-safe.
 *
 * Returns `{ ok: true }` if every reachable node is one of:
 *   - a plain object with string keys
 *   - an array
 *   - a string (UTF-8; no NFC normalization performed)
 *   - an integer in the safe-integer range
 *   - a boolean
 *   - null
 *
 * Returns `{ ok: false, error }` for the first violation encountered. Violations
 * include floats, NaN, Infinity, -Infinity, undefined, functions, symbols,
 * BigInt, Date/Map/Set instances, and any non-plain object.
 */
export function validateCanonicalSafe(value: unknown): CanonicalSafeCheck {
  const err = checkCanonicalSafe(value);
  return err === null ? { ok: true } : { ok: false, error: err };
}

/**
 * Zod schema for canonicalization-safe values.
 *
 * Equivalent to `validateCanonicalSafe` but expressed as a Zod schema for use
 * at parse boundaries. Use `validateCanonicalSafe` directly when you want the
 * structured `{ ok, error }` result; use this schema when chaining with other
 * Zod schemas.
 */
export const canonicalSafeSchema = z.unknown().superRefine((value, ctx) => {
  const err = checkCanonicalSafe(value);
  if (err !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: err });
  }
});
