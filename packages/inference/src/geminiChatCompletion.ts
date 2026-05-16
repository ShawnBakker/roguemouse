import { OpenAI } from "openai";

import { classifyInferenceError } from "./errors.js";
import type {
  ChatCompletionArgs,
  ChatCompletionData,
  InferenceResult,
  TokenUsage,
} from "./types.js";

/**
 * Default per-call `max_tokens` for Gemini calls. Higher than the
 * Vultr `chatCompletion` default (500) because Gemini reasoning models
 * (e.g., gemini-2.5-pro) tend to produce longer reasoning responses.
 * 1000 gives ample headroom for the Risk Officer voice's reasoning
 * output without being wasteful — billing is on actual completion
 * tokens, not the max_tokens ceiling.
 */
const DEFAULT_MAX_TOKENS = 1000;

/**
 * Perform a single chat completion against the configured Gemini client.
 *
 * Returns a discriminated-union envelope (`InferenceResult<ChatCompletionData>`):
 *   - On success the envelope carries the extracted `content`, the model
 *     identifier echoed by Gemini, the `finish_reason` (or null), and a
 *     camelCase `TokenUsage` re-keyed from Gemini's OpenAI-compat
 *     snake_case (`prompt_tokens` / `completion_tokens` / `total_tokens`).
 *   - On failure the envelope carries an `InferenceError` with a `code`,
 *     a `message`, and a `retryable` flag.
 *
 * Structurally identical to `chatCompletion` (the Vultr path) except for:
 *   1. `DEFAULT_MAX_TOKENS = 1000` (vs Vultr's 500).
 *   2. Intended call site is Gemini's OpenAI-compat endpoint
 *      (`https://generativelanguage.googleapis.com/v1beta/openai/`),
 *      configured via `createGeminiClient`.
 *
 * Error classification is shared with `chatCompletion` via the
 * package-internal `classifyInferenceError` in `./errors.js`. Per Sprint
 * 4a Brainstorm Decision 6A, Gemini errors map cleanly into the
 * `InferenceError` envelope without provider-specific extension —
 * including HTTP failures, network errors, malformed responses, and
 * safety-blocked responses (which surface as empty content via
 * `finish_reason: "content_filter"` or analog).
 *
 * Per CLAUDE.md hard rule 5, this function NEVER throws. Every error
 * path flows through `classifyInferenceError` into the envelope.
 */
export async function geminiChatCompletion(
  client: OpenAI,
  args: ChatCompletionArgs,
): Promise<InferenceResult<ChatCompletionData>> {
  try {
    const response = await client.chat.completions.create({
      model: args.model,
      messages: args.messages,
      max_tokens: args.maxTokens ?? DEFAULT_MAX_TOKENS,
    });

    const choice = response.choices[0];
    const content = choice?.message?.content;
    if (typeof content !== "string" || content.length === 0) {
      return {
        ok: false,
        error: {
          code: "empty_response",
          message:
            "Gemini response had no content in choices[0].message.content (possible safety block or rate-limited completion)",
          retryable: true,
        },
      };
    }

    const usage = response.usage;
    if (
      !usage ||
      !Number.isInteger(usage.prompt_tokens) ||
      !Number.isInteger(usage.completion_tokens) ||
      !Number.isInteger(usage.total_tokens) ||
      usage.prompt_tokens < 0 ||
      usage.completion_tokens < 0 ||
      usage.total_tokens < 0
    ) {
      return {
        ok: false,
        error: {
          code: "malformed_response",
          message:
            "Gemini response had missing or non-integer token usage",
          retryable: false,
        },
      };
    }

    const tokenUsage: TokenUsage = {
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
    };

    const data: ChatCompletionData = {
      content,
      model: response.model,
      finishReason: choice?.finish_reason ?? null,
    };

    return { ok: true, data, usage: tokenUsage };
  } catch (err: unknown) {
    return { ok: false, error: classifyInferenceError(err) };
  }
}
