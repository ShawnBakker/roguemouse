import { describe, it, expect } from "vitest";
import { z } from "zod";

import {
  RECORD_TYPES,
  auditRecordBodySchema,
  defineAuditRecord,
  recordTypeNameSchema,
  type AuditRecordBody,
  type RecordTypeName,
} from "./auditRecord.js";

/**
 * The locked inventory of 12 recordType names. Duplicated here intentionally
 * — if the array in `auditRecord.ts` drifts from this list, the inventory
 * test fails. This is the spec's order, byte-for-byte.
 */
const EXPECTED_RECORD_TYPES = [
  "smoke_test:chat_completion",
  "tool:call",
  "tool:result",
  "anomaly:detected",
  "risk_officer:reasoning",
  "ops_engineer:reasoning",
  "synthesizer:reasoning",
  "synthesizer:proposal",
  "synthesizer:refusal",
  "human:approval",
  "human:rejection",
  "final:committed",
] as const;

const VALID_TS = "2026-05-15T07:26:03.694Z";
const VALID_RUN_ID = "e7ec58ef-c65a-47ee-9b4f-095e073d23f7";
const VALID_HEX64 =
  "b44adada69b19012e01600e58f2fb29df2ae945ddf14f05dfa44eddde0a23bcc";

describe("RECORD_TYPES", () => {
  it("contains exactly 12 entries", () => {
    expect(RECORD_TYPES).toHaveLength(12);
  });

  it("matches the locked inventory in order", () => {
    expect(RECORD_TYPES).toEqual(EXPECTED_RECORD_TYPES);
  });

  it("contains no duplicate names", () => {
    expect(new Set(RECORD_TYPES).size).toBe(RECORD_TYPES.length);
  });
});

describe("recordTypeNameSchema", () => {
  it.each(EXPECTED_RECORD_TYPES)("accepts %s", (name) => {
    expect(() => recordTypeNameSchema.parse(name)).not.toThrow();
  });

  it("rejects an unknown name", () => {
    const result = recordTypeNameSchema.safeParse("not_a_record_type");
    expect(result.success).toBe(false);
  });

  it("rejects empty string", () => {
    const result = recordTypeNameSchema.safeParse("");
    expect(result.success).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(recordTypeNameSchema.safeParse(42).success).toBe(false);
    expect(recordTypeNameSchema.safeParse(null).success).toBe(false);
    expect(recordTypeNameSchema.safeParse(undefined).success).toBe(false);
  });
});

describe("defineAuditRecord — helper construction", () => {
  const emptyPayload = z.object({}).strict();

  it("returns a Zod schema that accepts a valid record", () => {
    const schema = defineAuditRecord("tool:call", emptyPayload);
    const result = schema.safeParse({
      ts: VALID_TS,
      runId: VALID_RUN_ID,
      recordType: "tool:call",
      previousHash: VALID_HEX64,
      payload: {},
    });
    expect(result.success).toBe(true);
  });

  it("rejects records whose recordType does not match the literal", () => {
    const schema = defineAuditRecord("tool:call", emptyPayload);
    const result = schema.safeParse({
      ts: VALID_TS,
      runId: VALID_RUN_ID,
      recordType: "tool:result",
      previousHash: VALID_HEX64,
      payload: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects records with an extra top-level field (.strict)", () => {
    const schema = defineAuditRecord("tool:call", emptyPayload);
    const result = schema.safeParse({
      ts: VALID_TS,
      runId: VALID_RUN_ID,
      recordType: "tool:call",
      previousHash: VALID_HEX64,
      payload: {},
      somethingExtra: "nope",
    });
    expect(result.success).toBe(false);
  });

  it("rejects records with a malformed ts (wrong regex)", () => {
    const schema = defineAuditRecord("tool:call", emptyPayload);
    const result = schema.safeParse({
      ts: "2026-05-15T07:26:03Z",
      runId: VALID_RUN_ID,
      recordType: "tool:call",
      previousHash: VALID_HEX64,
      payload: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects records with empty runId", () => {
    const schema = defineAuditRecord("tool:call", emptyPayload);
    const result = schema.safeParse({
      ts: VALID_TS,
      runId: "",
      recordType: "tool:call",
      previousHash: VALID_HEX64,
      payload: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects records with malformed previousHash (not 64-char hex)", () => {
    const schema = defineAuditRecord("tool:call", emptyPayload);
    const result = schema.safeParse({
      ts: VALID_TS,
      runId: VALID_RUN_ID,
      recordType: "tool:call",
      previousHash: "abc123",
      payload: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects records whose payload fails the supplied payload schema", () => {
    const namedPayload = z
      .object({ tag: z.string().min(1) })
      .strict();
    const schema = defineAuditRecord("tool:call", namedPayload);
    const result = schema.safeParse({
      ts: VALID_TS,
      runId: VALID_RUN_ID,
      recordType: "tool:call",
      previousHash: VALID_HEX64,
      payload: { wrong: "shape" },
    });
    expect(result.success).toBe(false);
  });
});

describe("defineAuditRecord — type narrowing", () => {
  it("preserves the literal recordType in the inferred type", () => {
    const schema = defineAuditRecord(
      "tool:call",
      z.object({}).strict(),
    );
    type Inferred = z.infer<typeof schema>;
    type RT = Inferred["recordType"];

    // Compile-time assertion: RT must be exactly "tool:call", not string
    // and not RecordTypeName. The two helpers below use TypeScript's
    // assignability rules to enforce this.
    const _exact: RT = "tool:call";
    void _exact;

    // @ts-expect-error — "tool:result" is not assignable to RT
    const _wrong: RT = "tool:result";
    void _wrong;

    // Runtime check is incidental; the compile-time checks above are
    // what matters. Including a trivial assertion so the test has a body.
    expect(schema).toBeDefined();
  });

  it("narrows correctly across multiple branches built from the helper", () => {
    const branchA = defineAuditRecord(
      "smoke_test:chat_completion",
      z.object({}).strict(),
    );
    const branchB = defineAuditRecord(
      "human:approval",
      z.object({}).strict(),
    );

    type RT_A = z.infer<typeof branchA>["recordType"];
    type RT_B = z.infer<typeof branchB>["recordType"];

    const a: RT_A = "smoke_test:chat_completion";
    const b: RT_B = "human:approval";
    void a;
    void b;

    expect(branchA).toBeDefined();
    expect(branchB).toBeDefined();
  });
});

describe("defineAuditRecord — RecordTypeName constraint", () => {
  it("compile-time rejects a recordType not in RECORD_TYPES", () => {
    // @ts-expect-error — "not_locked" is not assignable to RecordTypeName
    defineAuditRecord("not_locked", z.object({}).strict());
  });

  it("accepts every name in RECORD_TYPES at compile time", () => {
    // Iterating the array confirms every entry is assignable as TRecordType.
    // This is a runtime smoke check; the real compile-time guarantee comes
    // from the TRecordType extends RecordTypeName constraint in the helper.
    for (const name of RECORD_TYPES) {
      const schema = defineAuditRecord(name, z.object({}).strict());
      expect(schema).toBeDefined();
    }
  });
});

// Type-level smoke check: RecordTypeName has the expected shape.
// If RECORD_TYPES drifts, this assignment fails to compile.
const _typeCheck: RecordTypeName = "smoke_test:chat_completion";
void _typeCheck;

// ===========================================================================
// PHASE 4 — Discriminated-union assembly tests
//
// Everything below this divider was added in Phase 4 of the
// tool-schema-and-payload-narrowing sprint. The tests above cover
// the Phase 1 helper machinery; the tests below exercise the
// 12-branch discriminated union assembled from those helpers.
//
// One test in this section is marked "DELETE IN PHASE 5" — the
// cross-over test that compares the standalone Sprint 2 schema to
// the union's smoke-test branch. The standalone schema is removed
// in Phase 5, at which point that test no longer compiles.
// ===========================================================================

const VALID_UUID = "11111111-2222-4333-8444-555555555555";

function makeBaseEnvelope(recordType: string): {
  ts: string;
  runId: string;
  recordType: string;
  previousHash: string;
} {
  return {
    ts: VALID_TS,
    runId: VALID_RUN_ID,
    recordType,
    previousHash: VALID_HEX64,
  };
}

describe("auditRecordBodySchema — happy-path branches", () => {
  it("accepts smoke_test:chat_completion", () => {
    const record = {
      ...makeBaseEnvelope("smoke_test:chat_completion"),
      payload: {
        model: "nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16",
        prompt: "test prompt",
        response: "test response",
        tokens: { prompt: 10, completion: 20, total: 30 },
        durationMs: 1234,
      },
    };
    expect(auditRecordBodySchema.safeParse(record).success).toBe(true);
  });

  it("accepts tool:call", () => {
    const record = {
      ...makeBaseEnvelope("tool:call"),
      payload: {
        toolName: "market_data:lookup",
        invocationId: VALID_UUID,
        args: { symbol: "AAPL" },
      },
    };
    expect(auditRecordBodySchema.safeParse(record).success).toBe(true);
  });

  it("accepts tool:result", () => {
    const record = {
      ...makeBaseEnvelope("tool:result"),
      payload: {
        toolName: "market_data:lookup",
        invocationId: VALID_UUID,
        result: {
          ok: true,
          data: {
            spotPrice: 12345,
            impliedVolatility: 2350,
            realizedVolatility: 1800,
            surfaceTs: VALID_TS,
          },
        },
        durationMs: 50,
      },
    };
    expect(auditRecordBodySchema.safeParse(record).success).toBe(true);
  });

  it("accepts anomaly:detected", () => {
    const record = {
      ...makeBaseEnvelope("anomaly:detected"),
      payload: {
        anomalyType: "stale_iv_surface",
        severity: 75,
        evidence: { surfaceAgeMs: 3600000, expectedRefreshMs: 60000 },
        detectedAt: VALID_TS,
      },
    };
    expect(auditRecordBodySchema.safeParse(record).success).toBe(true);
  });

  it("accepts risk_officer:reasoning", () => {
    const record = {
      ...makeBaseEnvelope("risk_officer:reasoning"),
      payload: {
        input: { anomaly: "stale_iv", positions: [] },
        reasoning: "The IV surface is stale; downstream pricing will be wrong.",
        confidence: 8500,
        durationMs: 1200,
        tokens: { prompt: 500, completion: 200, total: 700 },
      },
    };
    expect(auditRecordBodySchema.safeParse(record).success).toBe(true);
  });

  it("accepts ops_engineer:reasoning (same shape as risk_officer)", () => {
    const record = {
      ...makeBaseEnvelope("ops_engineer:reasoning"),
      payload: {
        input: { surfaceTs: VALID_TS, lastRefreshMs: 60000 },
        reasoning: "Operational: the snapshot pipeline appears halted.",
        confidence: 7200,
        durationMs: 900,
        tokens: { prompt: 400, completion: 150, total: 550 },
      },
    };
    expect(auditRecordBodySchema.safeParse(record).success).toBe(true);
  });

  it("accepts synthesizer:reasoning", () => {
    const record = {
      ...makeBaseEnvelope("synthesizer:reasoning"),
      payload: {
        riskOfficerInput: { reasoning: "...", confidence: 8500 },
        opsEngineerInput: { reasoning: "...", confidence: 7200 },
        reasoning: "Both voices agree on the stale-surface diagnosis.",
        durationMs: 1500,
        tokens: { prompt: 800, completion: 300, total: 1100 },
      },
    };
    expect(auditRecordBodySchema.safeParse(record).success).toBe(true);
  });

  it("accepts synthesizer:proposal", () => {
    const record = {
      ...makeBaseEnvelope("synthesizer:proposal"),
      payload: {
        proposalText: "Pause new orders for the affected strategy.",
        supportingEvidence: [
          { source: "anomaly:detected", claim: "Surface is stale by >1h" },
          { source: "risk_officer:reasoning", claim: "Pricing will diverge" },
        ],
        expectedImpact: { pauseDurationMs: 600000 },
        confidence: 9100,
      },
    };
    expect(auditRecordBodySchema.safeParse(record).success).toBe(true);
  });

  it("accepts synthesizer:refusal", () => {
    const record = {
      ...makeBaseEnvelope("synthesizer:refusal"),
      payload: {
        reasonCode: "low_confidence",
        reasoningText: "Risk Officer circuit breaker is open; cannot proceed.",
        degradedInputs: [
          { source: "risk_officer", reason: "circuit_breaker_open" },
        ],
      },
    };
    expect(auditRecordBodySchema.safeParse(record).success).toBe(true);
  });

  it("accepts human:approval (with and without notes)", () => {
    const withNotes = {
      ...makeBaseEnvelope("human:approval"),
      payload: {
        proposalRunId: VALID_RUN_ID,
        approvedBy: "shawn",
        approvedAt: VALID_TS,
        notes: "Looks correct.",
      },
    };
    const withoutNotes = {
      ...makeBaseEnvelope("human:approval"),
      payload: {
        proposalRunId: VALID_RUN_ID,
        approvedBy: "shawn",
        approvedAt: VALID_TS,
      },
    };
    expect(auditRecordBodySchema.safeParse(withNotes).success).toBe(true);
    expect(auditRecordBodySchema.safeParse(withoutNotes).success).toBe(true);
  });

  it("accepts human:rejection", () => {
    const record = {
      ...makeBaseEnvelope("human:rejection"),
      payload: {
        proposalRunId: VALID_RUN_ID,
        rejectedBy: "shawn",
        rejectedAt: VALID_TS,
        reasonCode: "policy_violation",
      },
    };
    expect(auditRecordBodySchema.safeParse(record).success).toBe(true);
  });

  it("accepts final:committed", () => {
    const record = {
      ...makeBaseEnvelope("final:committed"),
      payload: {
        proposalRunId: VALID_RUN_ID,
        committedActions: [
          { type: "pause_orders", details: { strategyId: "vol-1" } },
        ],
        brokerMockId: "broker-mock-resp-001",
        committedAt: VALID_TS,
      },
    };
    expect(auditRecordBodySchema.safeParse(record).success).toBe(true);
  });
});

describe("auditRecordBodySchema — negative cases", () => {
  it("rejects an unknown recordType", () => {
    const record = {
      ...makeBaseEnvelope("tool:invented_new_kind"),
      payload: {},
    };
    expect(auditRecordBodySchema.safeParse(record).success).toBe(false);
  });

  it("rejects a payload that does not match its recordType (mismatch)", () => {
    const record = {
      ...makeBaseEnvelope("tool:call"),
      // Synthesizer-proposal-shaped payload on a tool:call recordType
      payload: {
        proposalText: "wrong shape for tool:call",
        supportingEvidence: [],
        expectedImpact: {},
        confidence: 9000,
      },
    };
    expect(auditRecordBodySchema.safeParse(record).success).toBe(false);
  });

  it("rejects a payload missing a required field for its recordType", () => {
    const record = {
      ...makeBaseEnvelope("human:approval"),
      payload: {
        proposalRunId: VALID_RUN_ID,
        approvedBy: "shawn",
        // missing approvedAt
      },
    };
    expect(auditRecordBodySchema.safeParse(record).success).toBe(false);
  });
});

describe("auditRecordBodySchema — type narrowing on safeParse", () => {
  it("narrows payload to the tool:call branch when recordType is tool:call", () => {
    const record = {
      ...makeBaseEnvelope("tool:call"),
      payload: {
        toolName: "market_data:lookup" as const,
        invocationId: VALID_UUID,
        args: { symbol: "AAPL" },
      },
    };
    const parsed = auditRecordBodySchema.safeParse(record);
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.recordType === "tool:call") {
      // Compile-time assertions inside the narrowed branch:
      const _toolName: string = parsed.data.payload.toolName;
      const _invocationId: string = parsed.data.payload.invocationId;
      void _toolName;
      void _invocationId;

      // @ts-expect-error — proposalText is not a field on tool:call payload
      const _wrong: string = parsed.data.payload.proposalText;
      void _wrong;
    }
  });

  it("exposes the union as the inferred AuditRecordBody type", () => {
    // Compile-time check: AuditRecordBody's recordType is the literal union,
    // not the widened `string`. If the union ever degrades, the assertions
    // below fail to compile.
    const rt: AuditRecordBody["recordType"] = "tool:call";
    void rt;

    // @ts-expect-error — "invented" is not a member of the union
    const bad: AuditRecordBody["recordType"] = "invented";
    void bad;

    expect(true).toBe(true);
  });
});

