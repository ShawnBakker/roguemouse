import {
  synthesizerResponseSchema,
  type SynthesizerResponse,
} from "./synthesizerResponseSchema.js";

/**
 * Sprint 4c placeholder constant for the Risk Officer and Ops Engineer
 * reasoning records' `confidence` field.
 *
 * These voices are advisors, not deciders — their confidence is
 * informational metadata in the audit log, NOT consumed by any
 * decision logic. The Synthesizer's confidence IS load-bearing
 * (drives proposal-vs-refusal via the
 * SYNTHESIZER_CONFIDENCE_THRESHOLD_BP threshold below) and IS real
 * (structured JSON from the model, parsed and Zod-validated).
 *
 * Real calibration for the upstream voices is deferred to Sprint 7
 * polish. See `tasks/todo.md` entry from 2026-05-17 titled "Sprint 7
 * polish: implement real confidence calibration for Risk Officer and
 * Ops Engineer reasoning records" for the options under consideration
 * (hedging-token frequency heuristic, separate confidence-rating
 * LLM sub-call, response-structure analysis).
 *
 * Honest placeholders are better than plausibly-wrong heuristics.
 * A 5000 constant signals "informational, not load-bearing" more
 * clearly than a heuristic that produces 4731 vs 6204 with no
 * principled difference.
 */
export const RISK_OPS_PLACEHOLDER_CONFIDENCE_BP = 5000;

/**
 * Synthesizer's confidence threshold for the proposal-vs-refusal
 * decision (locked at spec AC-22).
 *
 * Below this threshold, the run produces a refusal terminal record;
 * at or above, a proposal (subject to the model's stated decision
 * field per resolveTerminalDecision's full logic).
 *
 * Aesthetically matches the Scenario A IV/RV ratio threshold (also
 * 4500 bp = 0.45).
 */
export const SYNTHESIZER_CONFIDENCE_THRESHOLD_BP = 4500;

/**
 * Envelope-shaped result of parsing the Synthesizer's raw response
 * string. On failure carries enough context to populate a
 * `synthesizer:refusal` audit record's `reasonCode` and
 * `degradedInputs` fields directly.
 */
export type SynthesizerParseResult =
  | { ok: true; response: SynthesizerResponse }
  | {
      ok: false;
      reasonCode: string;
      degradedInputs: Array<{ source: string; reason: string }>;
    };

/**
 * Parse the Synthesizer's raw response string. Returns either the
 * validated structured response or a structured failure envelope.
 *
 * On JSON.parse failure: reasonCode = "synthesizer_malformed_response"
 * with degradedInputs naming the parse error.
 *
 * On Zod schema validation failure: same reasonCode, with
 * degradedInputs carrying a flattened summary of each Zod issue
 * (path joined with semicolons).
 *
 * Never throws. The orchestrator's chain stays intact even if the
 * model produces nonsense.
 */
export function parseSynthesizerResponse(raw: string): SynthesizerParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reasonCode: "synthesizer_malformed_response",
      degradedInputs: [
        {
          source: "synthesizer_response",
          reason: `JSON.parse failed: ${message}`,
        },
      ],
    };
  }
  const zodResult = synthesizerResponseSchema.safeParse(parsed);
  if (!zodResult.success) {
    const reason = zodResult.error.issues
      .map((iss) => `${iss.path.join(".") || "<root>"}: ${iss.message}`)
      .join("; ");
    return {
      ok: false,
      reasonCode: "synthesizer_malformed_response",
      degradedInputs: [
        {
          source: "synthesizer_response",
          reason: `schema validation failed: ${reason}`,
        },
      ],
    };
  }
  return { ok: true, response: zodResult.data };
}

/**
 * Apply the proposal-vs-refusal threshold rule (spec AC-22).
 *
 * Rules:
 *  - If response.decision === "refusal": always refusal (respect the
 *    model's explicit refusal regardless of confidence value; the
 *    model may refuse for reasons unrelated to confidence — e.g.,
 *    inconsistent inputs — and we honor that).
 *  - If response.decision === "proposal" AND confidence_bp >= 4500:
 *    proposal.
 *  - If response.decision === "proposal" AND confidence_bp < 4500:
 *    refusal (threshold override; the model stated a proposal but
 *    its self-reported confidence is below our acceptance floor).
 */
export function resolveTerminalDecision(
  response: SynthesizerResponse,
): "proposal" | "refusal" {
  if (response.decision === "refusal") return "refusal";
  if (response.confidence_bp >= SYNTHESIZER_CONFIDENCE_THRESHOLD_BP) {
    return "proposal";
  }
  return "refusal";
}
