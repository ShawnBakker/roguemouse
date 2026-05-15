import { describe, it, expect } from "vitest";
import { z } from "zod";

import { validateCanonicalSafe, canonicalSafeSchema } from "./canonicalSafe.js";

describe("validateCanonicalSafe — accepts safe values", () => {
  it.each<[string, unknown]>([
    ["null", null],
    ["empty string", ""],
    ["non-empty string", "hello"],
    ["UTF-8 string", "café 日本語"],
    ["integer 0", 0],
    ["positive integer", 42],
    ["negative integer", -100],
    ["MAX_SAFE_INTEGER", Number.MAX_SAFE_INTEGER],
    ["MIN_SAFE_INTEGER", Number.MIN_SAFE_INTEGER],
    ["true", true],
    ["false", false],
    ["empty array", []],
    ["array of integers", [1, 2, 3]],
    ["nested array", [[1], [2, 3]]],
    ["empty object", {}],
    ["simple object", { a: 1, b: "two" }],
    ["nested object", { a: { b: { c: 42 } } }],
    ["mixed", { name: "test", count: 3, items: ["a", null, true], meta: {} }],
    ["object with null-prototype prototype", Object.create(null)],
  ])("accepts %s", (_label, value) => {
    expect(validateCanonicalSafe(value)).toEqual({ ok: true });
  });
});

describe("validateCanonicalSafe — rejects unsafe values", () => {
  it("rejects NaN", () => {
    const r = validateCanonicalSafe(NaN);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/NaN/);
  });

  it("rejects Infinity", () => {
    const r = validateCanonicalSafe(Infinity);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Infinity/);
  });

  it("rejects -Infinity", () => {
    const r = validateCanonicalSafe(-Infinity);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/-Infinity/);
  });

  it("rejects undefined at top level", () => {
    const r = validateCanonicalSafe(undefined);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/undefined/);
  });

  it("rejects a non-integer number", () => {
    const r = validateCanonicalSafe(0.1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/non-integer/);
  });

  it("rejects an integer outside the safe range", () => {
    const r = validateCanonicalSafe(Number.MAX_SAFE_INTEGER + 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/safe range/);
  });

  it("rejects a function", () => {
    const r = validateCanonicalSafe(() => "fn");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/function/);
  });

  it("rejects a symbol", () => {
    const r = validateCanonicalSafe(Symbol("s"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/symbol/);
  });

  it("rejects a BigInt", () => {
    const r = validateCanonicalSafe(BigInt(42));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/BigInt/);
  });

  it("rejects a Date instance", () => {
    const r = validateCanonicalSafe(new Date());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Date/);
  });

  it("rejects a Map instance", () => {
    const r = validateCanonicalSafe(new Map());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Map/);
  });

  it("rejects a Set instance", () => {
    const r = validateCanonicalSafe(new Set());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Set/);
  });

  it("rejects a class instance (non-plain object)", () => {
    class Custom {
      x = 1;
    }
    const r = validateCanonicalSafe(new Custom());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/non-plain object/);
  });

  it("rejects a deeply nested unsafe value and names the path", () => {
    const r = validateCanonicalSafe({ outer: { inner: { bad: NaN } } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/outer\.inner\.bad.*NaN/);
  });

  it("rejects an unsafe array element and names the index", () => {
    const r = validateCanonicalSafe([1, 2, NaN]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/\[2\].*NaN/);
  });

  it("rejects an unsafe value inside nested array-of-object", () => {
    const r = validateCanonicalSafe({ items: [{ ok: 1 }, { bad: 0.5 }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/items\[1\]\.bad.*non-integer/);
  });
});

describe("canonicalSafeSchema (Zod)", () => {
  it("parses a valid value without throwing", () => {
    expect(() => canonicalSafeSchema.parse({ a: 1, b: ["x"] })).not.toThrow();
  });

  it("safeParse returns success: false for an unsafe value", () => {
    const r = canonicalSafeSchema.safeParse(NaN);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toMatch(/NaN/);
    }
  });

  it("composes with other Zod schemas", () => {
    const wrapped = z.object({ data: canonicalSafeSchema });
    expect(() => wrapped.parse({ data: { ok: 1 } })).not.toThrow();
    const r = wrapped.safeParse({ data: { bad: undefined } });
    expect(r.success).toBe(false);
  });
});
