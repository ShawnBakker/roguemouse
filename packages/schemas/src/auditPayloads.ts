import { z } from "zod";

import { canonicalSafeSchema } from "./canonicalSafe.js";
import {
  ISO_TIMESTAMP_MS_REGEX,
  TOOL_NAME_LITERALS,
} from "./primitives.js";

const toolNameSchema = z.enum(TOOL_NAME_LITERALS);

const tokensSchema = z
  .object({
    prompt: z.number().int().nonnegative(),
    completion: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  })
  .strict();

const supportingEvidenceItemSchema = z
  .object({
    source: z.string(),
    claim: z.string(),
  })
  .strict();

const degradedInputItemSchema = z
  .object({
    source: z.string(),
    reason: z.string(),
  })
  .strict();

const committedActionItemSchema = z
  .object({
    type: z.string(),
    details: canonicalSafeSchema,
  })
  .strict();

/**
 * Payload for `smoke_test:chat_completion`. Preserves the Sprint 2
 * locked shape: 5 fields exactly, integers in safe range, prompt and
 * response capped at 530 characters (500 + worst-case truncation
 * suffix).
 */
export const smokeTestChatCompletionPayload = z
  .object({
    model: z.string().min(1),
    prompt: z.string().max(530),
    response: z.string().max(530),
    tokens: tokensSchema,
    durationMs: z.number().int().nonnegative(),
  })
  .strict();

/**
 * Payload for `tool:call`. Recorded when the planner dispatches a
 * tool. The `args` field is typed as a canonicalization-safe value
 * at the audit-schema layer; narrowing args to the specific tool's
 * `ArgsFor<TName>` shape is the planner's responsibility (see
 * `dispatchTool` in `./tools/`).
 */
export const toolCallPayload = z
  .object({
    toolName: toolNameSchema,
    invocationId: z.string().uuid(),
    args: canonicalSafeSchema,
  })
  .strict();

/**
 * Payload for `tool:result`. Recorded when a tool dispatch returns.
 * The `result` field carries the `ToolResult<DataFor<TName>>`
 * envelope as JSON; the audit schema validates only that it is
 * canonicalization-safe.
 */
export const toolResultPayload = z
  .object({
    toolName: toolNameSchema,
    invocationId: z.string().uuid(),
    result: canonicalSafeSchema,
    durationMs: z.number().int().nonnegative(),
  })
  .strict();

/**
 * Payload for `anomaly:detected`. Recorded when the anomaly detector
 * flags input data. `anomalyType` stays free-form in Sprint 3;
 * Sprint 4-5 may narrow to a literal union.
 */
export const anomalyDetectedPayload = z
  .object({
    anomalyType: z.string(),
    severity: z.number().int().min(1).max(100),
    evidence: canonicalSafeSchema,
    detectedAt: z.string().regex(ISO_TIMESTAMP_MS_REGEX),
  })
  .strict();

/**
 * Payload for `risk_officer:reasoning`. 5-field strict shape per the
 * spec amendment: input, reasoning, confidence (basis points 0-10000),
 * durationMs, tokens.
 */
export const riskOfficerReasoningPayload = z
  .object({
    input: canonicalSafeSchema,
    reasoning: z.string(),
    confidence: z.number().int().min(0).max(10000),
    durationMs: z.number().int().nonnegative(),
    tokens: tokensSchema,
  })
  .strict();

/**
 * Payload for `ops_engineer:reasoning`. Same 5-field strict shape as
 * `risk_officer:reasoning`. Different voice, identical field set.
 */
export const opsEngineerReasoningPayload = z
  .object({
    input: canonicalSafeSchema,
    reasoning: z.string(),
    confidence: z.number().int().min(0).max(10000),
    durationMs: z.number().int().nonnegative(),
    tokens: tokensSchema,
  })
  .strict();

/**
 * Payload for `synthesizer:reasoning`. The synthesizer reconciles
 * the two voices. Per the spec amendment, includes tokens.
 */
export const synthesizerReasoningPayload = z
  .object({
    riskOfficerInput: canonicalSafeSchema,
    opsEngineerInput: canonicalSafeSchema,
    reasoning: z.string(),
    durationMs: z.number().int().nonnegative(),
    tokens: tokensSchema,
  })
  .strict();

/**
 * Payload for `synthesizer:proposal`. Recorded when the synthesizer
 * emits a remediation proposal.
 */
export const synthesizerProposalPayload = z
  .object({
    proposalText: z.string(),
    supportingEvidence: z.array(supportingEvidenceItemSchema),
    expectedImpact: canonicalSafeSchema,
    confidence: z.number().int().min(0).max(10000),
  })
  .strict();

/**
 * Payload for `synthesizer:refusal`. Recorded when the synthesizer
 * explicitly refuses to propose. This is the demo's high-trust
 * moment per `.claude/rules/hackathon.md`.
 */
export const synthesizerRefusalPayload = z
  .object({
    reasonCode: z.string(),
    reasoningText: z.string(),
    degradedInputs: z.array(degradedInputItemSchema),
  })
  .strict();

/**
 * Payload for `human:approval`. Recorded when the operator approves
 * a proposal.
 */
export const humanApprovalPayload = z
  .object({
    proposalRunId: z.string(),
    approvedBy: z.string(),
    approvedAt: z.string().regex(ISO_TIMESTAMP_MS_REGEX),
    notes: z.string().optional(),
  })
  .strict();

/**
 * Payload for `human:rejection`. Recorded when the operator rejects
 * a proposal.
 */
export const humanRejectionPayload = z
  .object({
    proposalRunId: z.string(),
    rejectedBy: z.string(),
    rejectedAt: z.string().regex(ISO_TIMESTAMP_MS_REGEX),
    reasonCode: z.string(),
    notes: z.string().optional(),
  })
  .strict();

/**
 * Payload for `final:committed`. Recorded when the broker mock
 * acknowledges the committed actions.
 */
export const finalCommittedPayload = z
  .object({
    proposalRunId: z.string(),
    committedActions: z.array(committedActionItemSchema),
    brokerMockId: z.string(),
    committedAt: z.string().regex(ISO_TIMESTAMP_MS_REGEX),
  })
  .strict();

