import { OpenAI } from "openai";

import { classifyInferenceError } from "./errors.js";
import type {
  ChatCompletionArgs,
  ChatCompletionData,
  InferenceResult,
  TokenUsage,
} from "./types.js";

/**
 * Default per-call `max_tokens`. The smoke prompt expects a single short
 * word ("OK"), so 500 is generous headroom; raising it costs nothing
 * since billing is on actual completion tokens.
 */
const DEFAULT_MAX_TOKENS = 500;

/**
 * Perform a single chat completion against the configured client.
 *
 * Returns a discriminated-union envelope (`InferenceResult<ChatCompletionData>`):
 *   - On success the envelope carries the extracted `content`, the model
 *     identifier echoed by the provider, the `finish_reason` (or null),
 *     and a camelCase `TokenUsage` re-keyed from the provider's snake_case.
 *   - On failure the envelope carries an `InferenceError` with a `code`,
 *     a `message`, and a `retryable` flag for Sprint 3's circuit breaker.
 *
 * Per CLAUDE.md hard rule 5, this function NEVER throws. Every error path —
 * including SDK exceptions, network errors, malformed responses, and empty
 * responses — flows through `classifyInferenceError` (from `./errors.js`)
 * into the envelope.
 */
export async function chatCompletion(
  client: OpenAI,
  args: ChatCompletionArgs,
): Promise<InferenceResult<ChatCompletionData>> {
  try {
    const response = await client.chat.completions.create({
      model: args.model,
      messages: args.messages,
      max_tokens: args.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(args.responseFormat ? { response_format: args.responseFormat } : {}),
    });

    const choice = response.choices[0];
    const content = choice?.message?.content;
    if (typeof content !== "string" || content.length === 0) {
      return {
        ok: false,
        error: {
          code: "empty_response",
          message:
            "Inference response had no content in choices[0].message.content",
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
            "Inference response had missing or non-integer token usage",
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
