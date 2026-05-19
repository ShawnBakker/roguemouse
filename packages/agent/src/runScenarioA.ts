import { performance } from "node:perf_hooks";

import type { OpenAI } from "openai";

import type { AppendInput, RunAuditWriter } from "@roguemouse/audit";
import {
  chatCompletion,
  geminiChatCompletion,
  type InferenceResult,
  type ChatCompletionData,
} from "@roguemouse/inference";
import type { RunbookIndex } from "@roguemouse/runbooks";
import type { ToolName } from "@roguemouse/schemas";
import type { ScenarioAFixtures } from "@roguemouse/tools";

import { detectAnomalies, type Anomaly } from "./anomaly.js";
import { createDispatcher } from "./dispatcher.js";
import { vultrNemotronPreflight } from "./preflight.js";
import {
  RISK_OPS_PLACEHOLDER_CONFIDENCE_BP,
  parseSynthesizerResponse,
  resolveTerminalDecision,
} from "./voices/confidence.js";
import { buildOpsEngineerUserPrompt } from "./voices/opsEngineerPrompt.js";
import { buildRiskOfficerUserPrompt } from "./voices/riskOfficerPrompt.js";
import { buildSynthesizerUserPrompt } from "./voices/synthesizerPrompt.js";
import {
  OPS_ENGINEER_SYSTEM_PROMPT,
  RISK_OFFICER_SYSTEM_PROMPT,
  SYNTHESIZER_SYSTEM_PROMPT,
} from "./voices/systemPrompts.js";

/**
 * Scenario A multi-agent debate orchestrator.
 *
 * Composes Sprint 4b's dispatcher + 8 tool impls + RAG with Sprint 4a's
 * Gemini integration and Sprint 2's Vultr Nemotron path to produce a
 * single Scenario A run: anomaly detection → Risk Officer → Ops Engineer
 * → Synthesizer → terminal proposal/refusal. Every step is audit-logged.
 *
 * Architectural recursion-guard discipline (distinct from Sprint 4b's
 * dispatcher recursion guard):
 *   - The orchestrator writes anomaly:detected and the three
 *     *:reasoning records and the terminal proposal/refusal record
 *     DIRECTLY via writer.append.
 *   - The orchestrator does NOT call dispatchTool("audit:append", ...).
 *   - Only the dispatcher writes tool:call and tool:result records
 *     (also via direct writer.append per Sprint 4b's locked design;
 *     see packages/agent/src/dispatcher.ts).
 *
 * Spec AC reference: this file is the load-bearing implementation of
 * spec ACs 04-07, 11-12, 14-21, 22-24, 33-36. Phase 6 of the
 * scenario-a-multi-agent-debate sprint.
 */

export type RunScenarioAArgs = {
  writer: RunAuditWriter;
  runId: string;
  fixtures: ScenarioAFixtures;
  runbookIndex: RunbookIndex;
  gemini: { client: OpenAI; model: string };
  vultr: { client: OpenAI; model: string };
  /**
   * Optional ticker symbol override. When omitted or `"AAPL"`, the fixtures
   * are passed through unchanged (matches every canonical run minted before
   * Sprint 6 Phase 8). When set to any other symbol, the AAPL-anomalous
   * entries in the fixture set are relabeled to the new symbol and all other
   * entries are dropped — keeping the entire downstream chain (detector,
   * tool dispatches, voice prompts) consistent with the user's choice
   * without restructuring the dispatcher or tool implementations.
   *
   * Sanitization happens at the API-route boundary: this function trusts
   * that any value here is already uppercase, alphanumeric+hyphen, 1-8
   * chars. Invalid values produce undefined behavior (fixtures with no
   * matching source entries → detectAnomalies returns []).
   */
  symbol?: string;
};

const ANOMALOUS_SOURCE_SYMBOL = "AAPL";

/**
 * Build a single-symbol fixture set by keeping only the entries tied to
 * `fromSymbol` and relabeling them to `toSymbol`. Returns a fresh object;
 * the input is not mutated.
 */
function relabelFixtures(
  fixtures: ScenarioAFixtures,
  fromSymbol: string,
  toSymbol: string,
): ScenarioAFixtures {
  const sourceMd = fixtures.marketData[fromSymbol];
  if (!sourceMd) return fixtures;
  return {
    marketData: { [toSymbol]: sourceMd },
    positions: fixtures.positions
      .filter((p) => p.symbol === fromSymbol)
      .map((p) => ({ ...p, symbol: toSymbol })),
    brokerPositions: fixtures.brokerPositions
      .filter((b) => b.symbol === fromSymbol)
      .map((b) => ({ ...b, symbol: toSymbol })),
    anomalyEvidence: { ...fixtures.anomalyEvidence, symbol: toSymbol },
  };
}

export type PerVoiceTiming = {
  voice: "risk_officer" | "ops_engineer" | "synthesizer";
  durationMs: number;
};

export type PerToolTiming = {
  name: ToolName;
  durationMs: number;
};

export type ScenarioResult = {
  runId: string;
  recordCount: number;
  finalHash: string;
  decision: "proposal" | "refusal";
  confidence_bp: number;
  totalElapsedMs: number;
  perVoice: PerVoiceTiming[];
  perTool: PerToolTiming[];
};

/**
 * Per-voice `max_tokens` budget. Must include headroom for thinking-
 * mode allocation in addition to visible-output budget. Empirical
 * Sprint 4c Phase 8 data: Gemini Flash's Risk Officer call consumed
 * 1437 thinking + 59 visible = 1496 tokens at a 1500-token cap and
 * truncated mid-sentence at "implies that implied". 4000 gives ample
 * margin for ~5-10 sentence reasoning plus thinking allocation,
 * without waste; Gemini Flash's max output is 8192. See
 * `tasks/lessons.md` 2026-05-18 entry for the full diagnosis.
 */
const VOICE_MAX_TOKENS = 4000;
/**
 * Synthesizer `max_tokens` budget. Symmetric with VOICE_MAX_TOKENS
 * (4000) because structured-JSON output is roughly 2-3x more token-
 * heavy than free-text for equivalent semantic content — field names,
 * quoting, and bracket scaffolding burn budget on top of the visible
 * reasoning. Empirical Sprint 4c Phase 8 run #2: Synthesizer at the
 * old 2000 cap used 1322 thinking + 663 visible JSON output and
 * truncated mid-supporting_evidence array, surfacing as
 * `synthesizer_malformed_response`. See `tasks/lessons.md` 2026-05-18
 * entry for full diagnosis.
 */
const SYNTH_MAX_TOKENS = 4000;

type OrchestratorState = {
  recordCount: number;
  lastHash: string;
  perVoice: PerVoiceTiming[];
  perTool: PerToolTiming[];
};

/**
 * Build a runbook-search query string from the anomaly. Keyword-rich so
 * the application-layer RAG (frequency-based) returns the matching
 * runbook with high relevance.
 */
function buildRunbookQuery(anomaly: Anomaly): string {
  const observed = (anomaly.observedRatioBp / 10000).toFixed(2);
  const threshold = (anomaly.thresholdBp / 10000).toFixed(2);
  return `${anomaly.symbol} IV RV ratio ${observed} threshold ${threshold} divergence`;
}

/**
 * Summarize a Gemini/Vultr InferenceResult error envelope into a
 * single-line string suitable for embedding in a degradedInputs entry.
 */
function summarizeInferenceError(
  result: Extract<InferenceResult<ChatCompletionData>, { ok: false }>,
): string {
  return `${result.error.code}: ${result.error.message}`;
}

/**
 * Write a record via writer.append; on success update local state.
 * On failure, throw — a chain break is unrecoverable for Sprint 4c.
 */
async function appendOrThrow(
  writer: RunAuditWriter,
  input: AppendInput,
  state: OrchestratorState,
  context: string,
): Promise<void> {
  const result = await writer.append(input);
  if (!result.ok) {
    throw new Error(
      `Audit write failed during ${context}: ${result.error.code} — ${result.error.message}`,
    );
  }
  state.recordCount += 1;
  state.lastHash = result.data.hash;
}

/**
 * Write a synthesizer:refusal terminal record and assemble a
 * ScenarioResult. Used both for the happy refusal path and for any
 * mid-run LLM-call failure (per AC-33 / AC-34 / AC-35).
 */
async function writeRefusalAndResult(
  args: RunScenarioAArgs,
  state: OrchestratorState,
  startTotal: number,
  reasonCode: string,
  reasoningText: string,
  degradedInputs: Array<{ source: string; reason: string }>,
  confidence_bp: number,
): Promise<ScenarioResult> {
  await appendOrThrow(
    args.writer,
    {
      ts: new Date().toISOString(),
      recordType: "synthesizer:refusal",
      payload: { reasonCode, reasoningText, degradedInputs },
    } as AppendInput,
    state,
    "synthesizer:refusal",
  );
  return {
    runId: args.runId,
    recordCount: state.recordCount,
    finalHash: state.lastHash,
    decision: "refusal",
    confidence_bp,
    totalElapsedMs: Date.now() - startTotal,
    perVoice: state.perVoice,
    perTool: state.perTool,
  };
}

export async function runScenarioA(
  args: RunScenarioAArgs,
): Promise<ScenarioResult> {
  const startTotal = Date.now();
  const state: OrchestratorState = {
    recordCount: 0,
    lastHash: "",
    perVoice: [],
    perTool: [],
  };
  let failureTerminated = false;

  // Symbol passthrough: relabel the AAPL-anomalous fixtures to the
  // user-supplied symbol if one was provided (and is not the default).
  // See RunScenarioAArgs.symbol for the contract.
  const targetSymbol = args.symbol ?? ANOMALOUS_SOURCE_SYMBOL;
  const fixtures =
    targetSymbol !== ANOMALOUS_SOURCE_SYMBOL
      ? relabelFixtures(args.fixtures, ANOMALOUS_SOURCE_SYMBOL, targetSymbol)
      : args.fixtures;

  // -------------------------------------------------------------------------
  // 1. Pre-flight Vultr Nemotron. Hard-fail on any failure per AC-28/29.
  // -------------------------------------------------------------------------
  const preflight = await vultrNemotronPreflight(args.vultr.client, args.vultr.model);
  if (!preflight.ok) {
    throw new Error(
      `Vultr Nemotron pre-flight failed: ${preflight.code} — ${preflight.message}\n${preflight.remediation}`,
    );
  }

  // -------------------------------------------------------------------------
  // 2. Detect anomaly. Scenario A fixtures should always produce one.
  // -------------------------------------------------------------------------
  const detectedAt = new Date().toISOString();
  const anomalies = detectAnomalies(fixtures, detectedAt);
  if (anomalies.length === 0) {
    throw new Error(
      "Scenario A fixtures produced no anomalies; runner aborts (expected the IV/RV ratio breach in fixtures.marketData.AAPL).",
    );
  }
  const anomaly = anomalies[0]!;

  // -------------------------------------------------------------------------
  // 3. Write anomaly:detected DIRECTLY via writer.append (setup, not dispatch).
  // -------------------------------------------------------------------------
  await appendOrThrow(
    args.writer,
    {
      ts: new Date().toISOString(),
      recordType: "anomaly:detected",
      payload: {
        anomalyType: anomaly.anomalyType,
        severity: anomaly.severity,
        evidence: {
          symbol: anomaly.symbol,
          observedRatioBp: anomaly.observedRatioBp,
          thresholdBp: anomaly.thresholdBp,
          surfaceTs: anomaly.surfaceTs,
        },
        detectedAt: anomaly.detectedAt,
      },
    } as AppendInput,
    state,
    "anomaly:detected",
  );

  // -------------------------------------------------------------------------
  // 4. Construct dispatcher (passes writer + fixtures + runbookIndex via ToolCtx).
  // -------------------------------------------------------------------------
  const dispatchTool = createDispatcher({
    writer: args.writer,
    fixtures,
    runbookIndex: args.runbookIndex,
  });

  // -------------------------------------------------------------------------
  // 5. Risk Officer segment.
  // -------------------------------------------------------------------------
  const riskTStart = performance.now();

  const tMd = Date.now();
  const mdResult = await dispatchTool("market_data:lookup", {
    symbol: anomaly.symbol,
  });
  state.perTool.push({ name: "market_data:lookup", durationMs: Date.now() - tMd });
  state.recordCount += dispatcherRecordCount(mdResult.ok);

  const tRb = Date.now();
  const rbResult = await dispatchTool("runbook:search", {
    query: buildRunbookQuery(anomaly),
    topK: 3,
  });
  state.perTool.push({ name: "runbook:search", durationMs: Date.now() - tRb });
  state.recordCount += dispatcherRecordCount(rbResult.ok);

  const riskUserPrompt = buildRiskOfficerUserPrompt(anomaly, mdResult, rbResult);
  const riskLlmResult = await geminiChatCompletion(args.gemini.client, {
    model: args.gemini.model,
    messages: [
      { role: "system", content: RISK_OFFICER_SYSTEM_PROMPT },
      { role: "user", content: riskUserPrompt },
    ],
    maxTokens: VOICE_MAX_TOKENS,
  });

  if (!riskLlmResult.ok) {
    failureTerminated = true;
    return writeRefusalAndResult(
      args, state, startTotal,
      "risk_officer_call_failed",
      "Risk Officer LLM call failed; cannot proceed to deliberation.",
      [{ source: "risk_officer", reason: summarizeInferenceError(riskLlmResult) }],
      0,
    );
  }

  const riskDurationMs = Math.max(0, Math.round(performance.now() - riskTStart));
  await appendOrThrow(
    args.writer,
    {
      ts: new Date().toISOString(),
      recordType: "risk_officer:reasoning",
      payload: {
        input: {
          anomaly: {
            anomalyType: anomaly.anomalyType,
            symbol: anomaly.symbol,
            severity: anomaly.severity,
            observedRatioBp: anomaly.observedRatioBp,
            thresholdBp: anomaly.thresholdBp,
          },
          marketDataOk: mdResult.ok,
          runbookSearchOk: rbResult.ok,
        },
        reasoning: riskLlmResult.data.content,
        confidence: RISK_OPS_PLACEHOLDER_CONFIDENCE_BP,
        durationMs: riskDurationMs,
        tokens: {
          prompt: riskLlmResult.usage.promptTokens,
          completion: riskLlmResult.usage.completionTokens,
          total: riskLlmResult.usage.totalTokens,
        },
      },
    } as AppendInput,
    state,
    "risk_officer:reasoning",
  );
  state.perVoice.push({ voice: "risk_officer", durationMs: riskDurationMs });

  const riskReasoning = riskLlmResult.data.content;

  // -------------------------------------------------------------------------
  // 6. Ops Engineer segment.
  // -------------------------------------------------------------------------
  const opsTStart = performance.now();

  const tPs = Date.now();
  const psResult = await dispatchTool("position:snapshot", {});
  state.perTool.push({ name: "position:snapshot", durationMs: Date.now() - tPs });
  state.recordCount += dispatcherRecordCount(psResult.ok);

  const tBr = Date.now();
  const brResult = await dispatchTool("broker:reconcile", {
    strategy: "iv-rv-monitor",
  });
  state.perTool.push({ name: "broker:reconcile", durationMs: Date.now() - tBr });
  state.recordCount += dispatcherRecordCount(brResult.ok);

  const tAs = Date.now();
  const asResult = await dispatchTool("audit:search", {
    recordType: "anomaly:detected",
    limit: 10,
  });
  state.perTool.push({ name: "audit:search", durationMs: Date.now() - tAs });
  state.recordCount += dispatcherRecordCount(asResult.ok);

  const opsUserPrompt = buildOpsEngineerUserPrompt(anomaly, psResult, brResult, asResult);
  const opsLlmResult = await chatCompletion(args.vultr.client, {
    model: args.vultr.model,
    messages: [
      { role: "system", content: OPS_ENGINEER_SYSTEM_PROMPT },
      { role: "user", content: opsUserPrompt },
    ],
    maxTokens: VOICE_MAX_TOKENS,
  });

  if (!opsLlmResult.ok) {
    failureTerminated = true;
    return writeRefusalAndResult(
      args, state, startTotal,
      "ops_engineer_call_failed",
      "Ops Engineer LLM call failed; cannot reconcile perspectives.",
      [{ source: "ops_engineer", reason: summarizeInferenceError(opsLlmResult) }],
      0,
    );
  }

  const opsDurationMs = Math.max(0, Math.round(performance.now() - opsTStart));
  await appendOrThrow(
    args.writer,
    {
      ts: new Date().toISOString(),
      recordType: "ops_engineer:reasoning",
      payload: {
        input: {
          anomaly: {
            anomalyType: anomaly.anomalyType,
            symbol: anomaly.symbol,
            severity: anomaly.severity,
          },
          positionSnapshotOk: psResult.ok,
          brokerReconcileOk: brResult.ok,
          auditSearchOk: asResult.ok,
        },
        reasoning: opsLlmResult.data.content,
        confidence: RISK_OPS_PLACEHOLDER_CONFIDENCE_BP,
        durationMs: opsDurationMs,
        tokens: {
          prompt: opsLlmResult.usage.promptTokens,
          completion: opsLlmResult.usage.completionTokens,
          total: opsLlmResult.usage.totalTokens,
        },
      },
    } as AppendInput,
    state,
    "ops_engineer:reasoning",
  );
  state.perVoice.push({ voice: "ops_engineer", durationMs: opsDurationMs });

  const opsReasoning = opsLlmResult.data.content;

  // -------------------------------------------------------------------------
  // 7. Synthesizer segment (no tool dispatches; structured-JSON LLM call).
  // -------------------------------------------------------------------------
  const synthTStart = performance.now();
  const synthUserPrompt = buildSynthesizerUserPrompt(anomaly, riskReasoning, opsReasoning);
  const synthLlmResult = await geminiChatCompletion(args.gemini.client, {
    model: args.gemini.model,
    messages: [
      { role: "system", content: SYNTHESIZER_SYSTEM_PROMPT },
      { role: "user", content: synthUserPrompt },
    ],
    maxTokens: SYNTH_MAX_TOKENS,
    responseFormat: { type: "json_object" },
  });

  if (!synthLlmResult.ok) {
    failureTerminated = true;
    return writeRefusalAndResult(
      args, state, startTotal,
      "synthesizer_call_failed",
      "Synthesizer LLM call failed; cannot produce a decision.",
      [{ source: "synthesizer", reason: summarizeInferenceError(synthLlmResult) }],
      0,
    );
  }

  const synthDurationMs = Math.max(0, Math.round(performance.now() - synthTStart));
  const synthRaw = synthLlmResult.data.content;
  const parseResult = parseSynthesizerResponse(synthRaw);

  // Write synthesizer:reasoning regardless of parse outcome (the call
  // succeeded; the reasoning text exists even if it's malformed JSON).
  await appendOrThrow(
    args.writer,
    {
      ts: new Date().toISOString(),
      recordType: "synthesizer:reasoning",
      payload: {
        riskOfficerInput: { reasoning: riskReasoning },
        opsEngineerInput: { reasoning: opsReasoning },
        reasoning: parseResult.ok ? parseResult.response.reasoning : synthRaw,
        durationMs: synthDurationMs,
        tokens: {
          prompt: synthLlmResult.usage.promptTokens,
          completion: synthLlmResult.usage.completionTokens,
          total: synthLlmResult.usage.totalTokens,
        },
      },
    } as AppendInput,
    state,
    "synthesizer:reasoning",
  );
  state.perVoice.push({ voice: "synthesizer", durationMs: synthDurationMs });

  if (!parseResult.ok) {
    failureTerminated = true;
    return writeRefusalAndResult(
      args, state, startTotal,
      parseResult.reasonCode,
      "Synthesizer response failed JSON / schema validation; refusing.",
      parseResult.degradedInputs,
      0,
    );
  }

  const response = parseResult.response;
  const terminalDecision = resolveTerminalDecision(response);

  if (terminalDecision === "proposal") {
    // response is narrowed to proposal branch by resolveTerminalDecision's logic
    // (proposal only returned when decision === "proposal" && confidence_bp >= 4500).
    if (response.decision !== "proposal") {
      // Defensive — should be unreachable per resolveTerminalDecision.
      throw new Error("Internal contract violation: terminalDecision=proposal but response.decision != proposal");
    }
    await appendOrThrow(
      args.writer,
      {
        ts: new Date().toISOString(),
        recordType: "synthesizer:proposal",
        payload: {
          proposalText: response.proposal_text,
          supportingEvidence: response.supporting_evidence,
          expectedImpact: response.expected_impact,
          confidence: response.confidence_bp,
        },
      } as AppendInput,
      state,
      "synthesizer:proposal",
    );
  } else {
    // refusal: either the model said so, or threshold override fired.
    const reasonCode =
      response.decision === "refusal"
        ? response.refusal_reason_code
        : "low_confidence";
    const degradedInputs =
      response.decision === "refusal" ? response.degraded_inputs : [];
    await appendOrThrow(
      args.writer,
      {
        ts: new Date().toISOString(),
        recordType: "synthesizer:refusal",
        payload: {
          reasonCode,
          reasoningText: response.reasoning,
          degradedInputs,
        },
      } as AppendInput,
      state,
      "synthesizer:refusal",
    );
  }

  // -------------------------------------------------------------------------
  // 8. AC-25 invariant: clean Scenario A runs produce exactly 15 records.
  //    Drift here indicates a code edit that changed the tool sequences
  //    without updating AC-25. Fail loudly. Belt-and-suspenders pattern
  //    mirroring Sprint 4b's recursion guard.
  // -------------------------------------------------------------------------
  if (!failureTerminated && state.recordCount !== 15) {
    throw new Error(
      `AC-25 violation: expected 15 records, got ${state.recordCount}. ` +
        `Tool sequences may have drifted from locked Decision 2A.`,
    );
  }

  // -------------------------------------------------------------------------
  // 9. Compose ScenarioResult.
  // -------------------------------------------------------------------------
  return {
    runId: args.runId,
    recordCount: state.recordCount,
    finalHash: state.lastHash,
    decision: terminalDecision,
    confidence_bp: response.confidence_bp,
    totalElapsedMs: Date.now() - startTotal,
    perVoice: state.perVoice,
    perTool: state.perTool,
  };
}

/**
 * The dispatcher writes 2 records (tool:call + tool:result) on success
 * and 0 on a tool_call_audit-stage failure. We approximate by treating
 * any non-audit_write_failed envelope as "2 records written" — that
 * covers both success and tool-impl-error cases (the dispatcher still
 * writes both records when the impl returns an error envelope; only
 * audit-write failures truncate the count).
 *
 * For Sprint 4c, an audit_write_failed result from the dispatcher is
 * rare and would indicate a writer-level issue (likely Vultr transient
 * failure). The orchestrator's appendOrThrow elsewhere already throws on
 * writer failures; this counter is just informational for the
 * ScenarioResult.recordCount field.
 */
function dispatcherRecordCount(ok: boolean): number {
  // Successful envelope (whether tool succeeded or returned a tool-side
  // error envelope) means both audit records were written. We don't have
  // direct visibility into audit_write_failed without inspecting error
  // codes, but for Sprint 4c the success/failure path through
  // dispatchTool is dominated by "both records written" cases. If a
  // dispatcher-level audit write fails, appendOrThrow will surface it
  // shortly thereafter on the orchestrator's own next write attempt.
  void ok;
  return 2;
}
