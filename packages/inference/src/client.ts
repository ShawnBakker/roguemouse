import { OpenAI } from "openai";

import type { InferenceClientConfig } from "./types.js";

/**
 * Construct an OpenAI-SDK-compatible client configured against a custom
 * `baseURL` (Vultr Serverless Inference, in our case).
 *
 * The factory keeps `process.env` reads out of this workspace package per
 * the stack rule — the caller (the smoke runner; later, the Next.js API
 * route) reads env values once at the entry point and passes them in.
 *
 * The returned instance is the unchanged `OpenAI` type from the official
 * SDK, so callers can drop down to the SDK if needed. The intended path
 * for Sprint 2 is for callers to go through `chatCompletion(client, args)`
 * which wraps the call in the structured-envelope contract.
 */
export function createInferenceClient(config: InferenceClientConfig): OpenAI {
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });
}
