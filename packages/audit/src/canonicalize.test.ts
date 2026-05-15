import { describe, it, expect } from "vitest";

import { canonicalize } from "./canonicalize.js";

describe("canonicalize — happy path serialization", () => {
  it("serializes null", () => {
    expect(canonicalize(null)).toBe("null");
  });

  it("serializes empty object", () => {
    expect(canonicalize({})).toBe("{}");
  });

  it("serializes empty array", () => {
    expect(canonicalize([])).toBe("[]");
  });

  it("serializes a single-key object", () => {
    expect(canonicalize({ a: "hello" })).toBe('{"a":"hello"}');
  });

  it("serializes integers", () => {
    expect(canonicalize(42)).toBe("42");
    expect(canonicalize(0)).toBe("0");
    expect(canonicalize(-100)).toBe("-100");
  });

  it("serializes booleans", () => {
    expect(canonicalize(true)).toBe("true");
    expect(canonicalize(false)).toBe("false");
  });

  it("serializes a string", () => {
    expect(canonicalize("hello")).toBe('"hello"');
  });
});

describe("canonicalize — key sorting", () => {
  it("sorts top-level object keys", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("sorts top-level keys regardless of insertion order", () => {
    const insertionA = { z: 1, a: 2, m: 3 };
    const insertionB = { a: 2, m: 3, z: 1 };
    const expected = '{"a":2,"m":3,"z":1}';
    expect(canonicalize(insertionA)).toBe(expected);
    expect(canonicalize(insertionB)).toBe(expected);
  });

  it("sorts nested object keys recursively", () => {
    const result = canonicalize({ outer: { z: 1, a: 2 }, alpha: { y: 3, b: 4 } });
    expect(result).toBe('{"alpha":{"b":4,"y":3},"outer":{"a":2,"z":1}}');
  });

  it("preserves array element order", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
  });

  it("sorts keys inside objects within arrays", () => {
    const result = canonicalize([
      { b: 1, a: 2 },
      { d: 3, c: 4 },
    ]);
    expect(result).toBe('[{"a":2,"b":1},{"c":4,"d":3}]');
  });
});

describe("canonicalize — determinism and canonicality", () => {
  it("produces identical output for identical input (determinism)", () => {
    const input = { name: "test", items: [1, 2, 3], meta: { count: 3 } };
    expect(canonicalize(input)).toBe(canonicalize(input));
  });

  it("produces identical output for structurally-equal inputs in different key orders (canonicality)", () => {
    const a = { name: "test", items: [1, 2, 3], meta: { count: 3 } };
    const b = { meta: { count: 3 }, items: [1, 2, 3], name: "test" };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });
});

describe("canonicalize — no whitespace in output", () => {
  it("emits no spaces, tabs, or newlines", () => {
    const result = canonicalize({ a: 1, b: { c: [2, 3] } });
    expect(result).not.toMatch(/\s/);
  });
});

describe("canonicalize — rejects values that fail canonicalSafe validation", () => {
  it("rejects NaN", () => {
    expect(() => canonicalize(NaN)).toThrow(/NaN/);
  });

  it("rejects Infinity", () => {
    expect(() => canonicalize(Infinity)).toThrow(/Infinity/);
  });

  it("rejects undefined", () => {
    expect(() => canonicalize(undefined)).toThrow(/undefined/);
  });

  it("rejects a non-integer number", () => {
    expect(() => canonicalize(0.1)).toThrow(/non-integer/);
  });

  it("rejects a Date instance", () => {
    expect(() => canonicalize(new Date())).toThrow(/Date/);
  });

  it("rejects a BigInt", () => {
    expect(() => canonicalize(BigInt(1))).toThrow(/BigInt/);
  });

  it("rejects a function", () => {
    expect(() => canonicalize(() => 1)).toThrow(/function/);
  });

  it("rejects an unsafe value nested in an object", () => {
    expect(() => canonicalize({ ok: 1, bad: NaN })).toThrow(/bad.*NaN/);
  });
});
