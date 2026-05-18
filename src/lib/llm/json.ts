import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { createOpenAiClient } from "@/lib/llm/openai";
import { estimateCompletionCost, logCostEstimate } from "@/lib/llm/cost";
import {
  DEFAULT_LLM_MODEL,
  type JsonCompletionRequest,
  type JsonCompletionResult,
  type LlmMessage,
  type LlmTokenUsage,
} from "@/lib/llm/types";

const DEFAULT_MAX_RETRIES = 1; // 2 attempts total — keeps Nova (30 s) and Forge (60 s) well within Vercel limits
const MAX_BACKOFF_MS = 10_000;
const BASE_BACKOFF_MS = 500;

const JSON_RESPONSE_SYSTEM =
  "You must respond with a single valid JSON object only. No markdown fences, prose, or commentary.";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
}

function toOpenAiMessages(messages: LlmMessage[]): ChatCompletionMessageParam[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

function mapUsage(usage: OpenAI.Completions.CompletionUsage | undefined): LlmTokenUsage {
  return {
    promptTokens: usage?.prompt_tokens ?? 0,
    completionTokens: usage?.completion_tokens ?? 0,
    totalTokens: usage?.total_tokens ?? 0,
  };
}

function buildSystemMessages(
  messages: LlmMessage[],
  jsonInstructions?: string,
): LlmMessage[] {
  const parts = [JSON_RESPONSE_SYSTEM];
  if (jsonInstructions?.trim()) {
    parts.push(jsonInstructions.trim());
  }
  const systemContent = parts.join("\n\n");
  const hasSystem = messages.some((m) => m.role === "system");
  if (hasSystem) {
    return messages.map((m) =>
      m.role === "system"
        ? { ...m, content: `${m.content}\n\n${systemContent}` }
        : m,
    );
  }
  return [{ role: "system", content: systemContent }, ...messages];
}

function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  const message = error.message.toLowerCase();
  return (
    message.includes("rate limit") ||
    message.includes("timeout") ||
    message.includes("503") ||
    message.includes("502") ||
    message.includes("500") ||
    message.includes("429")
  );
}

/**
 * Structured JSON completion: OpenAI `json_object` response, parse, Zod validate, retries.
 */
export async function completeJson<T>(
  request: JsonCompletionRequest<T>,
): Promise<JsonCompletionResult<T>> {
  const client =
    request.client ??
    createOpenAiClient(
      request.timeout !== undefined ? { timeout: request.timeout } : undefined,
    );
  const model = request.model ?? DEFAULT_LLM_MODEL;
  const maxRetries = request.maxRetries ?? DEFAULT_MAX_RETRIES;
  const messages = buildSystemMessages(request.messages, request.jsonInstructions);

  let lastError: unknown;
  let attempts = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    attempts = attempt + 1;
    try {
      const completion = await client.chat.completions.create({
        model,
        messages: toOpenAiMessages(messages),
        response_format: { type: "json_object" },
        temperature: request.options?.temperature,
        max_tokens: request.options?.maxTokens,
        top_p: request.options?.topP,
        stop: request.options?.stop,
      });

      const raw = completion.choices[0]?.message?.content;
      if (!raw) {
        throw new Error("OpenAI returned an empty completion.");
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (parseError) {
        throw new Error(
          `Failed to parse JSON from model output: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
        );
      }

      const data = request.schema.parse(parsed);
      const usage = mapUsage(completion.usage);
      const resolvedModel = completion.model ?? model;

      const cost = estimateCompletionCost(usage, resolvedModel);
      logCostEstimate(cost);

      return { data, model: resolvedModel, usage, attempts };
    } catch (error) {
      lastError = error;
      const canRetry = attempt < maxRetries;
      if (!canRetry) break;
      const isParseError =
        error instanceof Error && error.message.includes("parse");
      const isZodError =
        error !== null &&
        typeof error === "object" &&
        "issues" in error &&
        Array.isArray((error as { issues: unknown }).issues);
      if (!isRetryableError(error) && !isParseError && !isZodError) {
        break;
      }
      await sleep(backoffMs(attempt));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError ?? "JSON completion failed."));
}
