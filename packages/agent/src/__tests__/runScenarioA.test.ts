import { randomUUID } from "node:crypto";

import { OpenAI } from "openai";

import type {
  AppendInput,
  AppendResult,
  ListResult,
  ReadResult,
  RunAuditWriter,
} from "@roguemouse/audit";
import type { RunbookIndex } from "@roguemouse/runbooks";
import type { ScenarioAFixtures } from "@roguemouse/tools";

import { describe, expect, it } from "vitest";

import { runScenarioA, type RunScenarioAArgs } from "../runScenarioA.js";

const GEMINI_MODEL = "gemini-2.5-flash";
const VULTR_MODEL = "nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16";

const VALID_TS = "2026-05-16T09:31:14.000Z";

const FIXTURES: ScenarioAFixtures = {
  marketData: {
    AAPL: {
      spotPrice: 19450,
      impliedVolatility: 1680,
      realizedVolatility: 4000,
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
  ],
  brokerPositions: [
    {
      symbol: "AAPL",
      quantity: 100,
      brokerAccountId: "BROKER-001",
      asOf: VALID_TS,
    },
  ],
  anomalyEvidence: {
    anomalyId: "anom-test",
    symbol: "AAPL",
    metric: "iv_rv_ratio",
    observedValue: 4200,
    lowBoundThreshold: 4500,
    highBoundThreshold: 9500,
    detectedAt: VALID_TS,
  },
};

const RUNBOOK_INDEX: RunbookIndex = {
  docs: [
    {
      path: "/fake/iv-rv.md",
      excerpt: "Fake IV/RV excerpt.",
      totalTokens: 4,
      freq: new Map([
        ["iv", 1],
        ["rv", 1],
        ["ratio", 1],
        ["divergence", 1],
      ]),
    },
  ],
};

// ---------------------------------------------------------------------------
// Fake writer
// ---------------------------------------------------------------------------

type FakeWriter = {
  appendCalls: AppendInput[];
  writer: RunAuditWriter;
};

function makeFakeWriter(): FakeWriter {
  const appendCalls: AppendInput[] = [];
  let counter = 0;
  const impl = {
    async append(input: AppendInput): Promise<AppendResult> {
      appendCalls.push(input);
      counter += 1;
      const hash = counter.toString(16).padStart(64, "0");
      const previousHash =
        counter > 1
          ? (counter - 1).toString(16).padStart(64, "0")
          : "b44adada69b19012e01600e58f2fb29df2ae945ddf14f05dfa44eddde0a23bcc";
      return {
        ok: true,
        data: {
          key: `audit/fake-run/${input.ts.replace(/:/g, "-")}-${hash}.json`,
          hash,
          previousHash,
          canonicalJson: JSON.stringify(input),
        },
      };
    },
    async read(_key: string): Promise<ReadResult> {
      return {
        ok: false,
        error: { code: "not_used_in_test", message: "", retryable: false },
      };
    },
    async list(_args: { runIdPrefix?: string; limit?: number }): Promise<ListResult> {
      return {
        ok: true,
        data: { keys: appendCalls.map((_, i) => `key-${i}`), hasMore: false },
      };
    },
  };
  return { appendCalls, writer: impl as unknown as RunAuditWriter };
}

// ---------------------------------------------------------------------------
// Fake LLM clients
// ---------------------------------------------------------------------------

type FakeResponse = {
  content?: string;
  finishReason?: string | null;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

type Canned =
  | { kind: "ok"; response: FakeResponse }
  | { kind: "throw"; err: unknown };

function ok(content: string, usage = { prompt: 50, completion: 30, total: 80 }): Canned {
  return {
    kind: "ok",
    response: {
      content,
      finishReason: "stop",
      usage: {
        prompt_tokens: usage.prompt,
        completion_tokens: usage.completion,
        total_tokens: usage.total,
      },
    },
  };
}

function makeFakeClient(queue: Canned[]): {
  client: OpenAI;
  sentRequests: Array<{ model: string; hasResponseFormat: boolean }>;
} {
  const sentRequests: Array<{ model: string; hasResponseFormat: boolean }> = [];
  const fake = {
    chat: {
      completions: {
        async create(args: {
          model: string;
          response_format?: { type: string };
        }): Promise<{
          choices: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>;
          model: string;
          usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
        }> {
          sentRequests.push({
            model: args.model,
            hasResponseFormat: args.response_format !== undefined,
          });
          const next = queue.shift();
          if (!next) {
            throw new Error("fake client: no more canned responses queued");
          }
          if (next.kind === "throw") throw next.err;
          return {
            choices: [
              {
                message: { content: next.response.content ?? "" },
                finish_reason: next.response.finishReason ?? "stop",
              },
            ],
            model: args.model,
            usage: next.response.usage,
          };
        },
      },
    },
  };
  return { client: fake as unknown as OpenAI, sentRequests };
}

// ---------------------------------------------------------------------------
// Synth response factories
// ---------------------------------------------------------------------------

function proposalJson(confidence_bp: number): string {
  return JSON.stringify({
    decision: "proposal",
    confidence_bp,
    reasoning: "Voices align; the IV/RV breach is supported by clean position state.",
    proposal_text: "I recommend halving the AAPL position pending data quality re-check.",
    supporting_evidence: [
      { source: "risk_officer", claim: "ratio 0.42 below 0.45 floor" },
    ],
    expected_impact: { positionDeltaShares: -50 },
  });
}

function refusalJson(reasonCode: string): string {
  return JSON.stringify({
    decision: "refusal",
    confidence_bp: 3000,
    reasoning: "Inputs are inconsistent; recommending hold.",
    refusal_reason_code: reasonCode,
    degraded_inputs: [
      { source: "broker_reconcile", reason: "60-share divergence" },
    ],
  });
}

function makeArgs(opts: {
  vultrQueue: Canned[];
  geminiQueue: Canned[];
}): { args: RunScenarioAArgs; fakeWriter: FakeWriter } {
  const fakeWriter = makeFakeWriter();
  const vultr = makeFakeClient(opts.vultrQueue);
  const gemini = makeFakeClient(opts.geminiQueue);
  const args: RunScenarioAArgs = {
    writer: fakeWriter.writer,
    runId: randomUUID(),
    fixtures: FIXTURES,
    runbookIndex: RUNBOOK_INDEX,
    gemini: { client: gemini.client, model: GEMINI_MODEL },
    vultr: { client: vultr.client, model: VULTR_MODEL },
  };
  return { args, fakeWriter };
}

const PREFLIGHT_OK = ok("ok", { prompt: 1, completion: 1, total: 2 });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runScenarioA — happy path (proposal)", () => {
  it("produces exactly 15 records and decision=proposal at confidence 7500", async () => {
    const { args, fakeWriter } = makeArgs({
      // vultr: preflight + ops engineer
      vultrQueue: [PREFLIGHT_OK, ok("Operations engineer reasoning text.")],
      // gemini: risk officer + synthesizer
      geminiQueue: [
        ok("Risk officer reasoning text."),
        ok(proposalJson(7500)),
      ],
    });

    const result = await runScenarioA(args);

    expect(result.decision).toBe("proposal");
    expect(result.confidence_bp).toBe(7500);
    expect(result.recordCount).toBe(15);
    expect(result.perVoice).toHaveLength(3);
    expect(result.perTool).toHaveLength(5);
    expect(result.perTool.map((t) => t.name)).toEqual([
      "market_data:lookup",
      "runbook:search",
      "position:snapshot",
      "broker:reconcile",
      "audit:search",
    ]);
    expect(result.perVoice.map((v) => v.voice)).toEqual([
      "risk_officer",
      "ops_engineer",
      "synthesizer",
    ]);

    // Audit record order via writer appends
    const recordTypes = fakeWriter.appendCalls.map((c) => c.recordType);
    // Orchestrator writes 5 records (anomaly + 3 reasoning + terminal):
    expect(recordTypes).toContain("anomaly:detected");
    expect(recordTypes).toContain("risk_officer:reasoning");
    expect(recordTypes).toContain("ops_engineer:reasoning");
    expect(recordTypes).toContain("synthesizer:reasoning");
    expect(recordTypes).toContain("synthesizer:proposal");
    // First record is anomaly:detected
    expect(recordTypes[0]).toBe("anomaly:detected");
    // Last record is the terminal (synthesizer:proposal)
    expect(recordTypes[recordTypes.length - 1]).toBe("synthesizer:proposal");
  });
});

describe("runScenarioA — happy path (refusal via low confidence)", () => {
  it("emits synthesizer:refusal when confidence_bp < 4500 despite decision=proposal", async () => {
    const { args, fakeWriter } = makeArgs({
      vultrQueue: [PREFLIGHT_OK, ok("Ops reasoning.")],
      geminiQueue: [
        ok("Risk reasoning."),
        ok(proposalJson(3000)),
      ],
    });

    const result = await runScenarioA(args);

    expect(result.decision).toBe("refusal");
    expect(result.confidence_bp).toBe(3000);
    expect(result.recordCount).toBe(15);

    const lastCall = fakeWriter.appendCalls[fakeWriter.appendCalls.length - 1]!;
    expect(lastCall.recordType).toBe("synthesizer:refusal");
    const payload = lastCall.payload as { reasonCode: string };
    expect(payload.reasonCode).toBe("low_confidence");
  });
});

describe("runScenarioA — happy path (explicit refusal)", () => {
  it("emits synthesizer:refusal when synth's decision is refusal", async () => {
    const { args, fakeWriter } = makeArgs({
      vultrQueue: [PREFLIGHT_OK, ok("Ops reasoning.")],
      geminiQueue: [
        ok("Risk reasoning."),
        ok(refusalJson("inconsistent_voice_inputs")),
      ],
    });

    const result = await runScenarioA(args);

    expect(result.decision).toBe("refusal");
    expect(result.recordCount).toBe(15);

    const lastCall = fakeWriter.appendCalls[fakeWriter.appendCalls.length - 1]!;
    expect(lastCall.recordType).toBe("synthesizer:refusal");
    const payload = lastCall.payload as { reasonCode: string };
    expect(payload.reasonCode).toBe("inconsistent_voice_inputs");
  });
});

describe("runScenarioA — Risk Officer LLM call fails", () => {
  it("routes through terminateWithRefusal with reasonCode risk_officer_call_failed", async () => {
    const { args, fakeWriter } = makeArgs({
      vultrQueue: [PREFLIGHT_OK],
      geminiQueue: [
        {
          kind: "throw",
          err: new OpenAI.APIError(429, { error: { message: "rate limited" } }, "rate limited", undefined),
        },
      ],
    });

    const result = await runScenarioA(args);

    expect(result.decision).toBe("refusal");
    // 1 anomaly + 4 risk tool-flow records + 1 terminal refusal = 6
    expect(result.recordCount).toBe(6);
    expect(result.perVoice).toHaveLength(0); // Risk voice never completed

    const lastCall = fakeWriter.appendCalls[fakeWriter.appendCalls.length - 1]!;
    expect(lastCall.recordType).toBe("synthesizer:refusal");
    const payload = lastCall.payload as { reasonCode: string };
    expect(payload.reasonCode).toBe("risk_officer_call_failed");
  });
});

describe("runScenarioA — Ops Engineer LLM call fails", () => {
  it("routes through terminateWithRefusal with reasonCode ops_engineer_call_failed", async () => {
    const { args, fakeWriter } = makeArgs({
      vultrQueue: [
        PREFLIGHT_OK,
        {
          kind: "throw",
          err: new OpenAI.APIError(500, { error: { message: "server error" } }, "server error", undefined),
        },
      ],
      geminiQueue: [ok("Risk reasoning.")],
    });

    const result = await runScenarioA(args);

    expect(result.decision).toBe("refusal");
    // 1 anomaly + 4 risk tool-flow + 1 risk reasoning + 6 ops tool-flow + 1 terminal = 13
    expect(result.recordCount).toBe(13);
    expect(result.perVoice).toHaveLength(1); // Risk completed; Ops did not
    expect(result.perVoice[0]?.voice).toBe("risk_officer");

    const lastCall = fakeWriter.appendCalls[fakeWriter.appendCalls.length - 1]!;
    expect(lastCall.recordType).toBe("synthesizer:refusal");
    const payload = lastCall.payload as { reasonCode: string };
    expect(payload.reasonCode).toBe("ops_engineer_call_failed");
  });
});

describe("runScenarioA — Synthesizer LLM call fails", () => {
  it("routes through terminateWithRefusal with reasonCode synthesizer_call_failed", async () => {
    const { args, fakeWriter } = makeArgs({
      vultrQueue: [PREFLIGHT_OK, ok("Ops reasoning.")],
      geminiQueue: [
        ok("Risk reasoning."),
        {
          kind: "throw",
          err: new OpenAI.APIError(429, { error: { message: "rate limited" } }, "rate limited", undefined),
        },
      ],
    });

    const result = await runScenarioA(args);

    expect(result.decision).toBe("refusal");
    expect(result.perVoice).toHaveLength(2); // Risk + Ops completed; Synth did not

    const lastCall = fakeWriter.appendCalls[fakeWriter.appendCalls.length - 1]!;
    expect(lastCall.recordType).toBe("synthesizer:refusal");
    const payload = lastCall.payload as { reasonCode: string };
    expect(payload.reasonCode).toBe("synthesizer_call_failed");
  });
});

describe("runScenarioA — Synthesizer returns malformed JSON", () => {
  it("emits synthesizer:refusal with synthesizer_malformed_response", async () => {
    const { args, fakeWriter } = makeArgs({
      vultrQueue: [PREFLIGHT_OK, ok("Ops reasoning.")],
      geminiQueue: [
        ok("Risk reasoning."),
        ok("this is not valid json at all"),
      ],
    });

    const result = await runScenarioA(args);

    expect(result.decision).toBe("refusal");
    expect(result.recordCount).toBe(15); // synth:reasoning + terminal still written

    const lastCall = fakeWriter.appendCalls[fakeWriter.appendCalls.length - 1]!;
    expect(lastCall.recordType).toBe("synthesizer:refusal");
    const payload = lastCall.payload as { reasonCode: string };
    expect(payload.reasonCode).toBe("synthesizer_malformed_response");
  });
});

describe("runScenarioA — pre-flight fails (hard-fail throw)", () => {
  it("throws when Vultr pre-flight fails (AC-29: no envelope, no records)", async () => {
    const { args, fakeWriter } = makeArgs({
      vultrQueue: [
        {
          kind: "throw",
          err: new OpenAI.APIError(404, { error: { message: "model not found" } }, "model not found", undefined),
        },
      ],
      geminiQueue: [],
    });

    await expect(runScenarioA(args)).rejects.toThrow(/pre-flight failed/);
    expect(fakeWriter.appendCalls).toHaveLength(0);
  });
});

describe("runScenarioA — Synthesizer uses response_format", () => {
  it("the Synthesizer Gemini call sets response_format; other calls do not", async () => {
    const vultr = makeFakeClient([PREFLIGHT_OK, ok("Ops reasoning.")]);
    const gemini = makeFakeClient([
      ok("Risk reasoning."),
      ok(proposalJson(7500)),
    ]);
    const fakeWriter = makeFakeWriter();
    const args: RunScenarioAArgs = {
      writer: fakeWriter.writer,
      runId: randomUUID(),
      fixtures: FIXTURES,
      runbookIndex: RUNBOOK_INDEX,
      gemini: { client: gemini.client, model: GEMINI_MODEL },
      vultr: { client: vultr.client, model: VULTR_MODEL },
    };

    await runScenarioA(args);

    // Vultr: pre-flight (no response_format) + ops engineer (no response_format)
    expect(vultr.sentRequests).toHaveLength(2);
    expect(vultr.sentRequests.every((r) => !r.hasResponseFormat)).toBe(true);

    // Gemini: risk officer (no response_format) + synthesizer (response_format!)
    expect(gemini.sentRequests).toHaveLength(2);
    expect(gemini.sentRequests[0]?.hasResponseFormat).toBe(false);
    expect(gemini.sentRequests[1]?.hasResponseFormat).toBe(true);
  });
});
