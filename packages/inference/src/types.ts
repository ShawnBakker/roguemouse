/**
 * Per-call token usage reported by the inference provider. Field names are
 * camelCase (`promptTokens` / `completionTokens` / `totalTokens`); the
 * provider's snake_case wire format is re-keyed once at the boundary
 * in `chatCompletion.ts`.
 */
export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

/**
 * Classification of an inference failure. The `retryable` flag is the
 * contract for downstream retry logic (Sprint 3's circuit breaker will
 * consume it). Sprint 2's smoke runner does not retry; the field's
 * presence here is what makes the contract.
 *
 * Retryable: status 408, 429, 500-599, network errors, timeouts.
 * Not retryable: 400, 401, 403, 404, 422, malformed response, anything
 * else not explicitly retryable.
 */
export type InferenceError = {
  code: string;
  message: string;
  retryable: boolean;
};

/**
 * Discriminated-union envelope returned by every inference function.
 * Inference functions never throw — every error path returns
 * `{ ok: false, error }`.
 */
export type InferenceResult<T> =
  | { ok: true; data: T; usage: TokenUsage }
  | { ok: false; error: InferenceError };

/**
 * The three OpenAI-compatible message roles we support. Tool / function
 * roles are intentionally excluded — Vultr's models do not generally
 * support native function calling per `.claude/rules/vultr.md`.
 */
export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type ChatCompletionArgs = {
  model: string;
  messages: ChatMessage[];
  /** Optional override of the default per-call max-tokens (currently 500). */
  maxTokens?: number;
};

/**
 * The happy-path payload returned through the envelope's `data` field.
 * Kept minimal — the smoke runner extracts `content` for the audit record;
 * `model` and `finishReason` are useful diagnostics for failure analysis.
 */
export type ChatCompletionData = {
  content: string;
  model: string;
  finishReason: string | null;
};

export type InferenceClientConfig = {
  apiKey: string;
  baseURL: string;
};
