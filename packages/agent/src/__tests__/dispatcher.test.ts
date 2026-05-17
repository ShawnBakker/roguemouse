import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type {
  AppendInput,
  AppendResult,
  ListResult,
  ReadResult,
  RunAuditWriter,
} from "@roguemouse/audit";
import type { RunbookIndex } from "@roguemouse/runbooks";
import {
  TOOL_IMPLEMENTATIONS,
  type ScenarioAFixtures,
} from "@roguemouse/tools";

import { afterEach, describe, expect, it } from "vitest";

import { createDispatcher } from "../dispatcher.js";

type FakeWriter = {
  appendCalls: AppendInput[];
  readCalls: string[];
  listCalls: Array<{ runIdPrefix?: string; limit?: number }>;
  appendResponses: AppendResult[];
  /** When true, the next append() waits this many ms before resolving. */
  appendDelaysMs: number[];
  writer: RunAuditWriter;
};

const HASH_64 = "0".repeat(64);
const ONES_64 = "1".repeat(64);

const SUCCESS_APPEND: AppendResult = {
  ok: true,
  data: {
    key: "audit/fake/2026-05-16T00-00-00.000Z-" + HASH_64 + ".json",
    hash: HASH_64,
    previousHash: ONES_64,
    canonicalJson: "{}",
  },
};

function makeFakeWriter(opts?: {
  appendResponses?: AppendResult[];
  appendDelaysMs?: number[];
}): FakeWriter {
  const state: FakeWriter = {
    appendCalls: [],
    readCalls: [],
    listCalls: [],
    appendResponses: opts?.appendResponses ?? [],
    appendDelaysMs: opts?.appendDelaysMs ?? [],
    writer: {} as RunAuditWriter,
  };
  const impl = {
    async append(input: AppendInput): Promise<AppendResult> {
      state.appendCalls.push(input);
      const delay = state.appendDelaysMs.shift();
      if (delay !== undefined && delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      const next = state.appendResponses.shift();
      return next ?? SUCCESS_APPEND;
    },
    async read(key: string): Promise<ReadResult> {
      state.readCalls.push(key);
      return {
        ok: false,
        error: { code: "not_used", message: "", retryable: false },
      };
    },
    async list(args: { runIdPrefix?: string; limit?: number }): Promise<ListResult> {
      state.listCalls.push(args);
      return { ok: true, data: { keys: [], hasMore: false } };
    },
  };
  state.writer = impl as unknown as RunAuditWriter;
  return state;
}

const FIXTURES: ScenarioAFixtures = {
  marketData: {
    AAPL: {
      spotPrice: 19450,
      impliedVolatility: 1680,
      realizedVolatility: 4000,
      surfaceTs: "2026-05-16T09:31:14.000Z",
    },
  },
  positions: [],
  brokerPositions: [],
  anomalyEvidence: {
    anomalyId: "x",
    symbol: "AAPL",
    metric: "iv_rv_ratio",
    observedValue: 4200,
    lowBoundThreshold: 4500,
    highBoundThreshold: 9500,
    detectedAt: "2026-05-16T09:31:14.000Z",
  },
};

const RUNBOOK_INDEX: RunbookIndex = {
  docs: [
    {
      path: "/fake/iv-rv.md",
      excerpt: "fake",
      totalTokens: 1,
      freq: new Map([["iv", 1]]),
    },
  ],
};

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("createDispatcher — happy path", () => {
  it("writes tool:call and tool:result for a successful dispatch", async () => {
    const fake = makeFakeWriter();
    const dispatchTool = createDispatcher({
      writer: fake.writer,
      fixtures: FIXTURES,
      runbookIndex: RUNBOOK_INDEX,
    });

    const result = await dispatchTool("market_data:lookup", { symbol: "AAPL" });

    expect(result.ok).toBe(true);
    expect(fake.appendCalls).toHaveLength(2);
    expect(fake.appendCalls[0]?.recordType).toBe("tool:call");
    expect(fake.appendCalls[1]?.recordType).toBe("tool:result");

    const resultPayload = fake.appendCalls[1]!.payload as {
      toolName: string;
      invocationId: string;
      result: unknown;
      durationMs: number;
    };
    expect(resultPayload.toolName).toBe("market_data:lookup");
    expect(Number.isInteger(resultPayload.durationMs)).toBe(true);
    expect(resultPayload.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("createDispatcher — invocationId correlation", () => {
  it("uses the same UUIDv4 invocationId in tool:call and tool:result", async () => {
    const fake = makeFakeWriter();
    const dispatchTool = createDispatcher({
      writer: fake.writer,
      fixtures: FIXTURES,
      runbookIndex: RUNBOOK_INDEX,
    });

    await dispatchTool("market_data:lookup", { symbol: "AAPL" });

    const callPayload = fake.appendCalls[0]!.payload as { invocationId: string };
    const resultPayload = fake.appendCalls[1]!.payload as { invocationId: string };
    expect(callPayload.invocationId).toBe(resultPayload.invocationId);
    expect(callPayload.invocationId).toMatch(UUID_V4_REGEX);
  });
});

describe("createDispatcher — serial mutex", () => {
  it("serializes 3 concurrent dispatches: call1,result1,call2,result2,call3,result3", async () => {
    // 10ms delay on every append so that without a mutex, parallel
    // calls would interleave write order.
    const fake = makeFakeWriter({
      appendDelaysMs: [10, 10, 10, 10, 10, 10],
    });
    const dispatchTool = createDispatcher({
      writer: fake.writer,
      fixtures: FIXTURES,
      runbookIndex: RUNBOOK_INDEX,
    });

    await Promise.all([
      dispatchTool("market_data:lookup", { symbol: "AAPL" }),
      dispatchTool("market_data:lookup", { symbol: "AAPL" }),
      dispatchTool("market_data:lookup", { symbol: "AAPL" }),
    ]);

    expect(fake.appendCalls).toHaveLength(6);
    const types = fake.appendCalls.map((c) => c.recordType);
    expect(types).toEqual([
      "tool:call",
      "tool:result",
      "tool:call",
      "tool:result",
      "tool:call",
      "tool:result",
    ]);

    // invocationId pairing: pair (0,1), (2,3), (4,5) must each correlate.
    for (let pairStart = 0; pairStart < 6; pairStart += 2) {
      const callId = (fake.appendCalls[pairStart]!.payload as { invocationId: string }).invocationId;
      const resultId = (fake.appendCalls[pairStart + 1]!.payload as { invocationId: string }).invocationId;
      expect(callId).toBe(resultId);
    }
  });
});

describe("createDispatcher — tool:call audit-write failure", () => {
  it("returns audit_write_failed with step tool_call_audit and DOES NOT execute the impl", async () => {
    const fake = makeFakeWriter({
      appendResponses: [
        {
          ok: false,
          error: { code: "AccessDenied", message: "no", retryable: false, step: "s3_put" },
        },
      ],
    });
    const dispatchTool = createDispatcher({
      writer: fake.writer,
      fixtures: FIXTURES,
      runbookIndex: RUNBOOK_INDEX,
    });

    const result = await dispatchTool("market_data:lookup", { symbol: "AAPL" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("audit_write_failed");
      expect(result.error.step).toBe("tool_call_audit");
    }
    // Only the failed tool:call write was attempted. No tool:result.
    expect(fake.appendCalls).toHaveLength(1);
    expect(fake.appendCalls[0]?.recordType).toBe("tool:call");
  });
});

describe("createDispatcher — tool:result audit-write failure", () => {
  it("returns audit_write_failed with step tool_result_audit AFTER the impl ran", async () => {
    const fake = makeFakeWriter({
      appendResponses: [
        SUCCESS_APPEND, // tool:call succeeds
        {
          ok: false,
          error: { code: "AccessDenied", message: "no", retryable: false, step: "s3_put" },
        },
      ],
    });
    const dispatchTool = createDispatcher({
      writer: fake.writer,
      fixtures: FIXTURES,
      runbookIndex: RUNBOOK_INDEX,
    });

    const result = await dispatchTool("market_data:lookup", { symbol: "AAPL" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("audit_write_failed");
      expect(result.error.step).toBe("tool_result_audit");
    }
    expect(fake.appendCalls).toHaveLength(2);
  });
});

describe("createDispatcher — impl-internal throw is caught by the impl's own try/catch", () => {
  it("records tool_threw_internal in the tool:result payload (chain stays intact)", async () => {
    const fake = makeFakeWriter();
    const fixturesWithThrowingGetter = { ...FIXTURES };
    Object.defineProperty(fixturesWithThrowingGetter, "marketData", {
      get() {
        throw new Error("simulated impl-internal failure");
      },
    });
    const dispatchTool = createDispatcher({
      writer: fake.writer,
      fixtures: fixturesWithThrowingGetter as ScenarioAFixtures,
      runbookIndex: RUNBOOK_INDEX,
    });

    const result = await dispatchTool("market_data:lookup", { symbol: "AAPL" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("tool_threw_internal");
    }
    expect(fake.appendCalls).toHaveLength(2);
    const resultPayload = fake.appendCalls[1]!.payload as {
      result: { ok: boolean; error?: { code: string } };
    };
    expect(resultPayload.result.ok).toBe(false);
    expect(resultPayload.result.error?.code).toBe("tool_threw_internal");
  });
});

describe("createDispatcher — non-defensive impl throw is caught by the dispatcher's outer try/catch", () => {
  // Save and restore so other tests are not affected.
  const RESTORE: Array<() => void> = [];
  afterEach(() => {
    while (RESTORE.length > 0) {
      const fn = RESTORE.pop();
      if (fn) fn();
    }
  });

  it("returns tool_threw envelope AND records it in the tool:result payload", async () => {
    const original = TOOL_IMPLEMENTATIONS["market_data:lookup"];
    const throwingImpl = async () => {
      throw new Error("simulated unwrapped impl throw");
    };
    (TOOL_IMPLEMENTATIONS as unknown as Record<string, unknown>)[
      "market_data:lookup"
    ] = throwingImpl;
    RESTORE.push(() => {
      (TOOL_IMPLEMENTATIONS as unknown as Record<string, unknown>)[
        "market_data:lookup"
      ] = original;
    });

    const fake = makeFakeWriter();
    const dispatchTool = createDispatcher({
      writer: fake.writer,
      fixtures: FIXTURES,
      runbookIndex: RUNBOOK_INDEX,
    });

    const result = await dispatchTool("market_data:lookup", { symbol: "AAPL" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("tool_threw");
      expect(result.error.retryable).toBe(false);
      expect(result.error.message).toMatch(/simulated unwrapped impl throw/);
    }
    expect(fake.appendCalls).toHaveLength(2);
    const resultPayload = fake.appendCalls[1]!.payload as {
      result: { ok: boolean; error?: { code: string } };
    };
    expect(resultPayload.result.ok).toBe(false);
    expect(resultPayload.result.error?.code).toBe("tool_threw");
  });
});

describe("createDispatcher — unknown tool name (defensive)", () => {
  it("returns unknown_tool envelope when name has no implementation", async () => {
    const fake = makeFakeWriter();
    const dispatchTool = createDispatcher({
      writer: fake.writer,
      fixtures: FIXTURES,
      runbookIndex: RUNBOOK_INDEX,
    });

    const result = await (dispatchTool as unknown as (
      name: string,
      args: unknown,
    ) => Promise<{ ok: boolean; error?: { code: string } }>)(
      "does_not_exist:nope",
      {},
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("unknown_tool");
    expect(fake.appendCalls).toHaveLength(2);
    const resultPayload = fake.appendCalls[1]!.payload as {
      result: { error?: { code: string } };
    };
    expect(resultPayload.result.error?.code).toBe("unknown_tool");
  });
});

describe("createDispatcher — architectural recursion guard (source-level)", () => {
  it("dispatcher.ts contains exactly the expected grep counts", () => {
    const sourcePath = fileURLToPath(new URL("../dispatcher.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");

    const writerAppendCalls = (source.match(/ctx\.writer\.append\(/g) ?? []).length;
    const auditAppendLiterals = (source.match(/"audit:append"/g) ?? []).length;
    const dispatchToolCalls = (source.match(/dispatchTool\(/g) ?? []).length;

    expect(writerAppendCalls).toBe(2);
    expect(auditAppendLiterals).toBe(0);
    expect(dispatchToolCalls).toBe(0);
  });
});
