import { z } from "zod";

import { canonicalSafeSchema } from "@roguemouse/schemas";

/**
 * Zod schema for the Synthesizer voice's structured JSON response.
 *
 * The Synthesizer's LLM call uses `response_format: { type: "json_object" }`
 * (verified working against Gemini's OpenAI-compat endpoint in Phase 2's
 * pre-implementation probe). The system prompt (SYNTHESIZER_SYSTEM_PROMPT)
 * describes the two response shapes verbatim; this Zod schema enforces
 * them at parse time.
 *
 * Discriminated union on `decision`:
 *   - "proposal" branch: carries proposal_text, supporting_evidence,
 *     expected_impact.
 *   - "refusal" branch: carries refusal_reason_code, degraded_inputs.
 *
 * `refusal_reason_code` is intentionally `z.string().min(1)` rather than
 * a `z.enum(...)`. The system prompt suggests example codes
 * (`low_confidence`, `inconsistent_voice_inputs`, `degraded_data`) but
 * does not constrain — schema permissiveness allows the model to report
 * honest edge cases. Sprint 7 polish may revisit if a stable enum
 * emerges from live-run data.
 *
 * Parse-and-validate is handled by `parseSynthesizerResponse` in
 * `./confidence.ts` (Phase 4). On parse failure, the orchestrator
 * writes a `synthesizer:refusal` record with
 * `reasonCode: "synthesizer_malformed_response"` per spec AC-20.
 */

const supportingEvidenceItem = z
  .object({
    source: z.string().min(1),
    claim: z.string().min(1),
  })
  .strict();

const degradedInputItem = z
  .object({
    source: z.string().min(1),
    reason: z.string().min(1),
  })
  .strict();

const proposalBranchSchema = z
  .object({
    decision: z.literal("proposal"),
    confidence_bp: z.number().int().min(0).max(10000),
    reasoning: z.string().min(1),
    proposal_text: z.string().min(1),
    supporting_evidence: z.array(supportingEvidenceItem),
    expected_impact: canonicalSafeSchema,
  })
  .strict();

const refusalBranchSchema = z
  .object({
    decision: z.literal("refusal"),
    confidence_bp: z.number().int().min(0).max(10000),
    reasoning: z.string().min(1),
    refusal_reason_code: z.string().min(1),
    degraded_inputs: z.array(degradedInputItem),
  })
  .strict();

export const synthesizerResponseSchema = z.discriminatedUnion("decision", [
  proposalBranchSchema,
  refusalBranchSchema,
]);

export type SynthesizerResponse = z.infer<typeof synthesizerResponseSchema>;
