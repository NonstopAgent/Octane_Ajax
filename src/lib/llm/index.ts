import "server-only";

export {
  isOpenAiConfigured,
  getOpenAiApiKey,
  createOpenAiClient,
} from "@/lib/llm/openai";

export { completeJson } from "@/lib/llm/json";

export {
  estimateCompletionCost,
  logCostEstimate,
  type CostEstimate,
} from "@/lib/llm/cost";

export {
  DEFAULT_LLM_MODEL,
  LLM_MODEL_CONFIGS,
  type LlmRole,
  type LlmMessage,
  type LlmModelConfig,
  type LlmCompletionOptions,
  type LlmCompletionRequest,
  type LlmTokenUsage,
  type LlmCompletionResponse,
  type JsonCompletionRequest,
  type JsonCompletionResult,
} from "@/lib/llm/types";
