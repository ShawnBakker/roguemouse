import { OpenAI } from "openai";

import type { InferenceClientConfig } from "./types.js";

/**
 * Factory for an OpenAI SDK instance configured for Google's Gemini API
 * via its OpenAI-compatibility endpoint.
 *
 * Per Sprint 4a Brainstorm Decision 1B: Gemini exposes an
 * OpenAI-compatible chat-completions endpoint at:
 *   https://generativelanguage.googleapis.com/v1beta/openai/
 *
 * Calling this endpoint with a valid Gemini API key as the bearer token
 * via the existing `openai` SDK requires zero new direct dependencies.
 * The `chat.completions.create` response shape matches OpenAI's, so the
 * `geminiChatCompletion` wrapper can use the same response-handling and
 * error-classification logic as `chatCompletion` (Vultr path); both
 * share `classifyInferenceError` from `./errors.js`.
 *
 * Structurally near-identical to `createInferenceClient` — both wrap
 * `new OpenAI({ apiKey, baseURL })`. A separate factory exists for
 * reader clarity at call sites and as a natural home for future
 * Gemini-specific factory behavior (e.g., a default `extra_body` for
 * thinking-mode control if Sprint 7 needs it).
 *
 * The factory keeps `process.env` reads out of this workspace package
 * per the stack rule — the caller (the Gemini smoke runner; later, the
 * Next.js API route) reads env values once at the entry point and
 * passes them in.
 */
export function createGeminiClient(config: InferenceClientConfig): OpenAI {
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });
}
