import { OpenAI } from "openai";

import type { InferenceError } from "./types.js";

/**
 * Provider-agnostic error classification for LLM inference calls.
 *
 * Mirrors the `packages/audit/src/errors.ts` precedent (`classifyS3Error`):
 * a single error classifier shared across multiple consumer functions
 * within the same package. Inside `@roguemouse/inference`, both
 * `chatCompletion` (Vultr Serverless Inference) and `geminiChatCompletion`
 * (Gemini via its OpenAI-compatibility endpoint) hand thrown errors to
 * this function, which produces the canonical `InferenceError` shape.
 *
 * Both providers' errors flow through the official `openai` SDK, so the
 * classifier examines `OpenAI.APIError`, `OpenAI.APIConnectionError`,
 * `OpenAI.APIConnectionTimeoutError`, and standard Node network-error
 * codes. If a future provider has provider-specific error data not
 * capturable by `InferenceError`, that is a separate concern handled by
 * a separate classifier — the cross-provider envelope discipline is the
 * point of the abstraction.
 *
 * Internal helper. Not re-exported from the package barrel; consumers
 * see only the `InferenceError` shape via the `InferenceResult`
 * envelope.
 *
 * Retryability follows standard HTTP + network conventions:
 *   - HTTP 408 (request timeout), 429 (rate limit), 5xx → retryable.
 *   - HTTP 4xx other than 408/429 (auth, not-found, validation) → not retryable.
 *   - Connection / timeout errors (`APIConnectionError`,
 *     `APIConnectionTimeoutError`, `ECONNREFUSED`, `ETIMEDOUT`, `ENOTFOUND`,
 *     `ECONNRESET`) → retryable.
 *   - Anything else → not retryable.
 */
export function classifyInferenceError(err: unknown): InferenceError {
  if (err instanceof OpenAI.APIError) {
    const status = err.status;
    const code = err.code ?? `http_${status ?? "unknown"}`;

    if (typeof status === "number") {
      if (status === 408 || status === 429) {
        return { code, message: err.message, retryable: true };
      }
      if (status >= 500 && status < 600) {
        return { code, message: err.message, retryable: true };
      }
      if (status >= 400 && status < 500) {
        return { code, message: err.message, retryable: false };
      }
    }
    return { code, message: err.message, retryable: false };
  }

  if (err instanceof OpenAI.APIConnectionTimeoutError) {
    return {
      code: "network_timeout",
      message: err.message,
      retryable: true,
    };
  }

  if (err instanceof OpenAI.APIConnectionError) {
    return {
      code: "network",
      message: err.message,
      retryable: true,
    };
  }

  if (err instanceof Error) {
    const code = (err as Error & { code?: string }).code;
    if (
      code === "ECONNREFUSED" ||
      code === "ETIMEDOUT" ||
      code === "ENOTFOUND" ||
      code === "ECONNRESET"
    ) {
      return { code, message: err.message, retryable: true };
    }
    return { code: code ?? "unknown", message: err.message, retryable: false };
  }

  return {
    code: "unknown",
    message: typeof err === "string" ? err : "Unknown error",
    retryable: false,
  };
}
