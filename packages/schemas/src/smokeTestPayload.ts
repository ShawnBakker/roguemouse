import { z } from "zod";

/**
 * The Sprint-2-only payload shape for the smoke test's single
 * `smoke_test:chat_completion` audit record.
 *
 * Both `.strict()` markers enforce AC-31:
 *   - The payload object has exactly five fields (model, prompt, response,
 *     tokens, durationMs).
 *   - The tokens object has exactly three fields (prompt, completion, total).
 *
 * The 530-char ceiling on `prompt` and `response` accommodates the 500-char
 * truncated value plus the worst-case truncation suffix length
 * (`... [truncated; N chars total]`), per AC-32.
 *
 * Sprint 3 will replace this Sprint-2-specific payload shape with a
 * discriminated-union schema across all recordTypes. This shape is locked
 * only for Sprint 2.
 */
export const smokeTestChatCompletionPayloadSchema = z
  .object({
    model: z.string().min(1),
    prompt: z.string().max(530),
    response: z.string().max(530),
    tokens: z
      .object({
        prompt: z.number().int().nonnegative(),
        completion: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
      })
      .strict(),
    durationMs: z.number().int().nonnegative(),
  })
  .strict();

export type SmokeTestChatCompletionPayload = z.infer<
  typeof smokeTestChatCompletionPayloadSchema
>;
