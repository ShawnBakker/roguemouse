export const __packageName = "@roguemouse/inference";

export { createInferenceClient } from "./client.js";
export { chatCompletion } from "./chatCompletion.js";

export type {
  ChatCompletionArgs,
  ChatCompletionData,
  ChatMessage,
  ChatRole,
  InferenceClientConfig,
  InferenceError,
  InferenceResult,
  TokenUsage,
} from "./types.js";
