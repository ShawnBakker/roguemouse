import { describe, it, expect } from "vitest";

import { TOOL_NAME_LITERALS, type ToolNameLiteral } from "../primitives.js";
import {
  TOOLS,
  type ArgsFor,
  type DataFor,
  type ToolName,
} from "./registry.js";

/**
 * Type-level equality helper. `Equal<A, B>` resolves to `true` iff A
 * and B are mutually assignable. `Expect<true>` is a no-op;
 * `Expect<false>` is a compile error. Together: assert two types are
 * equal at compile time.
 */
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2)
  ? true
  : false;
type Expect<T extends true> = T;

const EXPECTED_TOOL_NAMES = [
  "market_data:lookup",
  "runbook:search",
  "position:snapshot",
  "broker:reconcile",
  "audit:append",
  "audit:search",
  "score:explain",
  "policy:check",
] as const;

describe("TOOLS registry", () => {
  it("has exactly 8 entries", () => {
    expect(Object.keys(TOOLS).length).toBe(8);
  });

  it("contains the locked tool inventory in order", () => {
    const names = Object.values(TOOLS).map((t) => t.name);
    expect(names).toEqual(EXPECTED_TOOL_NAMES);
  });

  it("contains no duplicate names", () => {
    const names = Object.values(TOOLS).map((t) => t.name);
    expect(new Set(names).size).toBe(8);
  });
});

describe("ToolName type", () => {
  it("equals the locked literal union (compile-time test)", () => {
    type _check = Expect<
      Equal<
        ToolName,
        | "market_data:lookup"
        | "runbook:search"
        | "position:snapshot"
        | "broker:reconcile"
        | "audit:append"
        | "audit:search"
        | "score:explain"
        | "policy:check"
      >
    >;
    const _t: _check = true;
    void _t;

    expect(true).toBe(true);
  });

  it("equals ToolNameLiteral from primitives.ts (single-source check)", () => {
    // If a tool file's `.name` literal drifts from TOOL_NAME_LITERALS,
    // ToolName (derived from TOOLS) and ToolNameLiteral (derived from
    // TOOL_NAME_LITERALS) become different unions, and this check
    // fails to compile. The runtime body of the test is incidental;
    // the real assertion is at the type level.
    type _check = Expect<Equal<ToolName, ToolNameLiteral>>;
    const _t: _check = true;
    void _t;

    // Runtime sanity: the array length matches the registry size.
    expect(TOOL_NAME_LITERALS).toHaveLength(8);
    expect(Object.keys(TOOLS)).toHaveLength(8);
  });
});

describe("ArgsFor<TName> type narrowing", () => {
  it("narrows market_data:lookup args to { symbol: string }", () => {
    type Args = ArgsFor<"market_data:lookup">;
    type _check = Expect<Equal<Args, { symbol: string }>>;
    const _t: _check = true;
    void _t;

    // @ts-expect-error — { sym: "AAPL" } is not assignable to { symbol: string }
    const _bad: Args = { sym: "AAPL" };
    void _bad;

    expect(true).toBe(true);
  });

  it("narrows runbook:search args to { query: string, topK: number }", () => {
    type Args = ArgsFor<"runbook:search">;
    type _check = Expect<Equal<Args, { query: string; topK: number }>>;
    const _t: _check = true;
    void _t;

    expect(true).toBe(true);
  });
});

describe("DataFor<TName> type narrowing", () => {
  it("narrows audit:append result data to { key, hash, previousHash }", () => {
    type Data = DataFor<"audit:append">;
    type _check = Expect<
      Equal<Data, { key: string; hash: string; previousHash: string }>
    >;
    const _t: _check = true;
    void _t;

    expect(true).toBe(true);
  });
});

describe("TOOLS — runtime schema smoke (one valid example per tool)", () => {
  it("market_data:lookup args parses a valid input", () => {
    expect(
      TOOLS.marketDataLookup.argsSchema.safeParse({ symbol: "AAPL" }).success,
    ).toBe(true);
  });

  it("market_data:lookup args rejects extra fields (.strict)", () => {
    expect(
      TOOLS.marketDataLookup.argsSchema.safeParse({ symbol: "AAPL", extra: 1 }).success,
    ).toBe(false);
  });

  it("market_data:lookup result data parses a valid input", () => {
    const valid = {
      spotPrice: 12345,
      impliedVolatility: 2350,
      realizedVolatility: 1800,
      surfaceTs: "2026-05-15T07:26:03.694Z",
    };
    expect(TOOLS.marketDataLookup.resultDataSchema.safeParse(valid).success).toBe(true);
  });

  it("market_data:lookup result rejects volatility above 10000", () => {
    const invalid = {
      spotPrice: 12345,
      impliedVolatility: 10001,
      realizedVolatility: 1800,
      surfaceTs: "2026-05-15T07:26:03.694Z",
    };
    expect(TOOLS.marketDataLookup.resultDataSchema.safeParse(invalid).success).toBe(false);
  });

  it("runbook:search args parses a valid input", () => {
    expect(
      TOOLS.runbookSearch.argsSchema.safeParse({ query: "stale IV surface", topK: 5 }).success,
    ).toBe(true);
  });

  it("runbook:search args rejects topK out of range", () => {
    expect(
      TOOLS.runbookSearch.argsSchema.safeParse({ query: "x", topK: 11 }).success,
    ).toBe(false);
    expect(
      TOOLS.runbookSearch.argsSchema.safeParse({ query: "x", topK: 0 }).success,
    ).toBe(false);
  });

  it("runbook:search result data parses a valid input", () => {
    const valid = {
      matches: [
        { path: "runbooks/iv-surface.md", excerpt: "stale data", relevanceScore: 7500 },
      ],
    };
    expect(TOOLS.runbookSearch.resultDataSchema.safeParse(valid).success).toBe(true);
  });

  it("position:snapshot args accepts both fields optional", () => {
    expect(TOOLS.positionSnapshot.argsSchema.safeParse({}).success).toBe(true);
    expect(
      TOOLS.positionSnapshot.argsSchema.safeParse({ strategy: "vol" }).success,
    ).toBe(true);
    expect(
      TOOLS.positionSnapshot.argsSchema.safeParse({ symbol: "AAPL" }).success,
    ).toBe(true);
  });

  it("position:snapshot result allows signed quantities", () => {
    const valid = {
      positions: [
        {
          strategy: "vol",
          symbol: "AAPL",
          quantity: -50,
          avgEntryPrice: 18000,
          currentPrice: 19500,
          asOf: "2026-05-15T07:26:03.694Z",
        },
      ],
    };
    expect(TOOLS.positionSnapshot.resultDataSchema.safeParse(valid).success).toBe(true);
  });

  it("broker:reconcile args requires non-empty strategy", () => {
    expect(TOOLS.brokerReconcile.argsSchema.safeParse({ strategy: "" }).success).toBe(false);
    expect(
      TOOLS.brokerReconcile.argsSchema.safeParse({ strategy: "vol" }).success,
    ).toBe(true);
  });

  it("broker:reconcile result data parses a valid input", () => {
    const valid = {
      brokerPositions: [
        {
          symbol: "AAPL",
          quantity: 100,
          brokerAccountId: "broker-mock-001",
          asOf: "2026-05-15T07:26:03.694Z",
        },
      ],
    };
    expect(TOOLS.brokerReconcile.resultDataSchema.safeParse(valid).success).toBe(true);
  });

  it("audit:append args requires a locked recordType", () => {
    expect(
      TOOLS.auditAppend.argsSchema.safeParse({
        recordType: "tool:call",
        payload: {},
      }).success,
    ).toBe(true);
    expect(
      TOOLS.auditAppend.argsSchema.safeParse({
        recordType: "not_locked",
        payload: {},
      }).success,
    ).toBe(false);
  });

  it("audit:append args rejects canonicalization-unsafe payload", () => {
    expect(
      TOOLS.auditAppend.argsSchema.safeParse({
        recordType: "tool:call",
        payload: { bad: NaN },
      }).success,
    ).toBe(false);
  });

  it("audit:append result data parses a valid input", () => {
    const valid = {
      key: "audit/run-id/2026-05-15T07-26-03.694Z-deadbeef.json",
      hash: "b44adada69b19012e01600e58f2fb29df2ae945ddf14f05dfa44eddde0a23bcc",
      previousHash:
        "b44adada69b19012e01600e58f2fb29df2ae945ddf14f05dfa44eddde0a23bcc",
    };
    expect(TOOLS.auditAppend.resultDataSchema.safeParse(valid).success).toBe(true);
  });

  it("audit:search args requires limit in range 1-100", () => {
    expect(TOOLS.auditSearch.argsSchema.safeParse({ limit: 50 }).success).toBe(true);
    expect(TOOLS.auditSearch.argsSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(TOOLS.auditSearch.argsSchema.safeParse({ limit: 101 }).success).toBe(false);
  });

  it("audit:search args accepts optional recordType (locked union)", () => {
    expect(
      TOOLS.auditSearch.argsSchema.safeParse({
        recordType: "synthesizer:proposal",
        limit: 10,
      }).success,
    ).toBe(true);
  });

  it("audit:search result accepts a record conforming to a locked recordType + payload (forward-compatible with Phase 4)", () => {
    const validRecord = {
      ts: "2026-05-15T07:26:03.694Z",
      runId: "e7ec58ef-c65a-47ee-9b4f-095e073d23f7",
      recordType: "smoke_test:chat_completion",
      previousHash:
        "b44adada69b19012e01600e58f2fb29df2ae945ddf14f05dfa44eddde0a23bcc",
      payload: {
        model: "nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16",
        prompt: "test",
        response: "ok",
        tokens: { prompt: 5, completion: 1, total: 6 },
        durationMs: 100,
      },
    };
    const valid = { records: [validRecord], hasMore: false };
    expect(TOOLS.auditSearch.resultDataSchema.safeParse(valid).success).toBe(true);
  });

  it("score:explain args rejects scoreValue out of -100..100 range", () => {
    expect(
      TOOLS.scoreExplain.argsSchema.safeParse({ strategy: "x", scoreValue: 101 }).success,
    ).toBe(false);
    expect(
      TOOLS.scoreExplain.argsSchema.safeParse({ strategy: "x", scoreValue: -101 }).success,
    ).toBe(false);
    expect(
      TOOLS.scoreExplain.argsSchema.safeParse({ strategy: "x", scoreValue: 75 }).success,
    ).toBe(true);
  });

  it("score:explain result data accepts components with signed contribution and bounded weight", () => {
    const valid = {
      components: [
        { name: "alpha", contribution: -5, weight: 3000 },
        { name: "beta", contribution: 10, weight: 7000 },
      ],
      narrative: "explanation",
    };
    expect(TOOLS.scoreExplain.resultDataSchema.safeParse(valid).success).toBe(true);
  });

  it("policy:check args accepts a canonicalSafe details object", () => {
    expect(
      TOOLS.policyCheck.argsSchema.safeParse({
        action: { type: "place_order", details: { symbol: "AAPL", qty: 100 } },
      }).success,
    ).toBe(true);
  });

  it("policy:check args rejects canonicalization-unsafe details", () => {
    expect(
      TOOLS.policyCheck.argsSchema.safeParse({
        action: { type: "x", details: { rate: 0.1 } },
      }).success,
    ).toBe(false);
  });

  it("policy:check result data parses a valid input", () => {
    expect(
      TOOLS.policyCheck.resultDataSchema.safeParse({
        allowed: true,
        violations: [],
      }).success,
    ).toBe(true);
  });

  it("policy:check result data parses a denial with violations", () => {
    expect(
      TOOLS.policyCheck.resultDataSchema.safeParse({
        allowed: false,
        violations: [{ policyName: "max-position-size", reason: "exceeds cap" }],
      }).success,
    ).toBe(true);
  });
});
