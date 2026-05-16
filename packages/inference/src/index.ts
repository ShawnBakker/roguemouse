export const __packageName = "@roguemouse/inference";

export { createInferenceClient } from "./client.js";
export { chatCompletion } from "./chatCompletion.js";

export { createGeminiClient } from "./geminiClient.js";
export { geminiChatCompletion } from "./geminiChatCompletion.js";

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
