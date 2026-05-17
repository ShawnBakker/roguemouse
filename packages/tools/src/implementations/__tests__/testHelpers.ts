import type {
  AppendInput,
  AppendResult,
  ListResult,
  ReadResult,
  RunAuditWriter,
} from "@roguemouse/audit";
import type { RunbookIndex } from "@roguemouse/runbooks";

import type { ScenarioAFixtures } from "../../fixtures/scenarioASchema.js";
import type { ToolCtx } from "../../toolCtx.js";

export type FakeWriter = {
  appendCalls: AppendInput[];
  listCalls: Array<{ runIdPrefix?: string; limit?: number }>;
  readCalls: string[];
  appendResponses: AppendResult[];
  listResponses: ListResult[];
  readResponses: Map<string, ReadResult>;
  /** Default ReadResult when readResponses has no entry for a key. */
  defaultReadResponse?: ReadResult;
  writer: RunAuditWriter;
};

const SUCCESS_HASH = "0".repeat(64);

const DEFAULT_APPEND_SUCCESS: AppendResult = {
  ok: true,
  data: {
    key: "audit/fake-run/2026-05-16T00-00-00.000Z-" + SUCCESS_HASH + ".json",
    hash: SUCCESS_HASH,
    previousHash: "1".repeat(64),
    canonicalJson: "{}",
  },
};

export function makeFakeWriter(initialResponses?: {
  appendResponses?: AppendResult[];
  listResponses?: ListResult[];
  readResponses?: Map<string, ReadResult>;
  defaultReadResponse?: ReadResult;
}): FakeWriter {
  const state: FakeWriter = {
    appendCalls: [],
    listCalls: [],
    readCalls: [],
    appendResponses: initialResponses?.appendResponses ?? [],
    listResponses: initialResponses?.listResponses ?? [],
    readResponses: initialResponses?.readResponses ?? new Map(),
    defaultReadResponse: initialResponses?.defaultReadResponse,
    writer: {} as RunAuditWriter, // placeholder, filled below
  };

  const writerImpl = {
    async append(input: AppendInput): Promise<AppendResult> {
      state.appendCalls.push(input);
      const next = state.appendResponses.shift();
      return next ?? DEFAULT_APPEND_SUCCESS;
    },
    async list(args: { runIdPrefix?: string; limit?: number }): Promise<ListResult> {
      state.listCalls.push(args);
      const next = state.listResponses.shift();
      return next ?? { ok: true, data: { keys: [], hasMore: false } };
    },
    async read(key: string): Promise<ReadResult> {
      state.readCalls.push(key);
      const exact = state.readResponses.get(key);
      if (exact) return exact;
      if (state.defaultReadResponse) return state.defaultReadResponse;
      return {
        ok: false,
        error: {
          code: "no_fake_response",
          message: `Fake writer has no read response for key: ${key}`,
          retryable: false,
          step: "s3_get",
        },
      };
    },
  };

  state.writer = writerImpl as unknown as RunAuditWriter;
  return state;
}

const VALID_TS = "2026-05-16T09:31:14.000Z";

export const DEFAULT_FIXTURES: ScenarioAFixtures = {
  marketData: {
    AAPL: {
      spotPrice: 19450,
      impliedVolatility: 1680,
      realizedVolatility: 4000,
      surfaceTs: VALID_TS,
    },
    MSFT: {
      spotPrice: 42100,
      impliedVolatility: 2200,
      realizedVolatility: 2150,
      surfaceTs: VALID_TS,
    },
  },
  positions: [
    {
      strategy: "iv-rv-monitor",
      symbol: "AAPL",
      quantity: 100,
      avgEntryPrice: 19200,
      currentPrice: 19450,
      asOf: VALID_TS,
    },
    {
      strategy: "iv-rv-monitor",
      symbol: "MSFT",
      quantity: 50,
      avgEntryPrice: 42000,
      currentPrice: 42100,
      asOf: VALID_TS,
    },
    {
      strategy: "momentum-baseline",
      symbol: "GOOGL",
      quantity: 25,
      avgEntryPrice: 17500,
      currentPrice: 17850,
      asOf: VALID_TS,
    },
  ],
  brokerPositions: [
    {
      symbol: "AAPL",
      quantity: 100,
      brokerAccountId: "BROKER-001",
      asOf: VALID_TS,
    },
    {
      symbol: "MSFT",
      quantity: 49,
      brokerAccountId: "BROKER-001",
      asOf: VALID_TS,
    },
    {
      symbol: "GOOGL",
      quantity: 25,
      brokerAccountId: "BROKER-001",
      asOf: VALID_TS,
    },
  ],
  anomalyEvidence: {
    anomalyId: "anom-fake-001",
    symbol: "AAPL",
    metric: "iv_rv_ratio",
    observedValue: 4200,
    lowBoundThreshold: 4500,
    highBoundThreshold: 9500,
    detectedAt: VALID_TS,
  },
};

export const DEFAULT_RUNBOOK_INDEX: RunbookIndex = {
  docs: [
    {
      path: "/fake/runbook/iv-rv.md",
      excerpt: "Fake IV/RV excerpt.",
      totalTokens: 4,
      freq: new Map([
        ["iv", 1],
        ["rv", 1],
        ["ratio", 1],
        ["divergence", 1],
      ]),
    },
    {
      path: "/fake/runbook/audit.md",
      excerpt: "Fake audit excerpt.",
      totalTokens: 3,
      freq: new Map([
        ["audit", 1],
        ["chain", 1],
        ["integrity", 1],
      ]),
    },
  ],
};

export function makeCtx(
  overrides?: Partial<{
    writer: RunAuditWriter;
    fixtures: ScenarioAFixtures;
    runbookIndex: RunbookIndex;
  }>,
): ToolCtx {
  return {
    writer: overrides?.writer ?? makeFakeWriter().writer,
    fixtures: overrides?.fixtures ?? DEFAULT_FIXTURES,
    runbookIndex: overrides?.runbookIndex ?? DEFAULT_RUNBOOK_INDEX,
  };
}
