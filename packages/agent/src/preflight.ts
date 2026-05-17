import type { OpenAI } from "openai";

import { chatCompletion } from "@roguemouse/inference";

/**
 * Result of a pre-flight check. Mirrors the envelope discipline used
 * across `@roguemouse/inference`, `@roguemouse/audit`, and the
 * Synthesizer parser: success carries no extra data; failure carries
 * structured error context plus an actionable remediation string for
 * the smoke runner to surface.
 */
export type PreflightResult =
  | { ok: true }
  | {
      ok: false;
      code: string;
      message: string;
      remediation: string;
    };

/**
 * Pre-flight `max_tokens` budget. Set to 2000 after empirical Sprint
 * 4c Phase 8 data showed Vultr Nemotron-Reasoning's thinking
 * allocation is non-deterministic — `PREFLIGHT_MAX_TOKENS = 500`
 * produced `empty_response` 1 out of 3 trial runs, with the model
 * apparently exhausting the budget on internal chain-of-thought
 * before emitting visible content. 2000 should be deterministic for
 * a trivial "ok" probe; cost ~$0.0008 per pre-flight, still negligible.
 * See `tasks/lessons.md` 2026-05-18 entry for the full diagnosis
 * across all three token-budget surfaces (pre-flight, voice, synth).
 * Sprint 7 polish: retry-on-empty-response semantics (see
 * `tasks/todo.md` 2026-05-18 entry).
 */
const PREFLIGHT_MAX_TOKENS = 2000;

/**
 * Probe the Vultr Nemotron model with a minimal chat-completion call
 * to verify availability before invoking the Ops Engineer voice
 * (per spec AC-28 / AC-29). Aborts the run on any failure; retries
 * with backoff are deferred to Sprint 7 polish.
 *
 * The probe issues a 1-2 word user prompt with `max_tokens: 10`. Any
 * envelope failure from the underlying chatCompletion (HTTP 404 for
 * a rotated model, HTTP 401/403 for a bad key, HTTP 429/5xx for
 * transient issues, network errors, empty responses, malformed token
 * usage) surfaces as a single `PreflightResult` with `ok: false`.
 *
 * The remediation string names the failed model and points the
 * operator at https://api.vultrinference.com/v1/models for the
 * current catalog. The Vultr Inference model list can rotate when
 * the catalog is updated; if a rotation is the cause, the operator
 * updates ROGUEMOUSE_CONTEXT.md + .env.local's VULTR_OPS_MODEL.
 */
export async function vultrNemotronPreflight(
  client: OpenAI,
  model: string,
): Promise<PreflightResult> {
  const result = await chatCompletion(client, {
    model,
    messages: [{ role: "user", content: "ok" }],
    maxTokens: PREFLIGHT_MAX_TOKENS,
  });
  if (!result.ok) {
    return {
      ok: false,
      code: result.error.code,
      message: result.error.message,
      remediation:
        `Vultr Nemotron pre-flight failed for model '${model}'. ` +
        `Verify the model is in the current catalog at https://api.vultrinference.com/v1/models. ` +
        `If the model has rotated, update VULTR_OPS_MODEL in .env.local and the locked value in ROGUEMOUSE_CONTEXT.md. ` +
        `If the catalog is reachable but the call fails with auth errors, verify VULTR_INFERENCE_API_KEY is valid.`,
    };
  }
  return { ok: true };
}
