import type { z } from "zod";
import type OpenAI from "openai";

/** Supported chat roles for completion requests. */
export type LlmRole = "system" | "user" | "assistant" | "developer";

export interface LlmMessage {
  role: LlmRole;
  content: string;
}

/** Per-model pricing hints for cost stubs (USD per 1M tokens). */
export interface LlmModelConfig {
  id: string;
  label: string;
  inputUsdPer1M: number;
  outputUsdPer1M: number;
  maxOutputTokens?: number;
}

export interface LlmCompletionOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string[];
}

export interface LlmCompletionRequest {
  messages: LlmMessage[];
  model?: string;
  options?: LlmCompletionOptions;
}

export interface LlmTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LlmCompletionResponse {
  content: string;
  model: string;
  usage: LlmTokenUsage;
}

/** Logical task used to route to the best provider/model (see llm/providers). */
export type LlmTask =
  | "ideation"
  | "listing"
  | "scoring"
  | "marketing"
  | "strategy"
  | "default";

export interface JsonCompletionRequest<T> extends LlmCompletionRequest {
  schema: z.ZodType<T>;
  /** Extra system instructions (JSON shape hints, field names, etc.). */
  jsonInstructions?: string;
  maxRetries?: number;
  /** Per-request OpenAI client timeout in ms (used when `client` is omitted). */
  timeout?: number;
  /** Inject a client for tests; production callers omit this. */
  client?: OpenAI;
  /** Routes to the best provider/model for this task (falls back to OpenAI). */
  task?: LlmTask;
}

export interface JsonCompletionResult<T> {
  data: T;
  model: string;
  usage: LlmTokenUsage;
  attempts: number;
}

export const DEFAULT_LLM_MODEL = "gpt-4o-mini";

export const LLM_MODEL_CONFIGS: Record<string, LlmModelConfig> = {
  "gpt-4o-mini": {
    id: "gpt-4o-mini",
    label: "GPT-4o mini",
    inputUsdPer1M: 0.15,
    outputUsdPer1M: 0.6,
    maxOutputTokens: 16_384,
  },
  "gpt-4o": {
    id: "gpt-4o",
    label: "GPT-4o",
    inputUsdPer1M: 2.5,
    outputUsdPer1M: 10,
    maxOutputTokens: 16_384,
  },
  "claude-sonnet-4-6": {
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    inputUsdPer1M: 3,
    outputUsdPer1M: 15,
    maxOutputTokens: 8_192,
  },
  "gemini-2.0-flash": {
    id: "gemini-2.0-flash",
    label: "Gemini 2.0 Flash",
    inputUsdPer1M: 0.1,
    outputUsdPer1M: 0.4,
    maxOutputTokens: 8_192,
  },
};
