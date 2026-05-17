import { LLM_MODEL_CONFIGS } from "@/lib/llm/types";
import type { LlmTokenUsage } from "@/lib/llm/types";

export interface CostEstimate {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  inputUsd: number;
  outputUsd: number;
  estimatedUsd: number;
  /** Stub flag — no DB persistence yet. */
  persisted: false;
}

/** Estimate USD cost from token usage and model pricing table (stub; not persisted). */
export function estimateCompletionCost(
  usage: LlmTokenUsage,
  model: string,
): CostEstimate {
  const config = LLM_MODEL_CONFIGS[model] ?? LLM_MODEL_CONFIGS["gpt-4o-mini"];
  const inputUsd =
    (usage.promptTokens / 1_000_000) * config.inputUsdPer1M;
  const outputUsd =
    (usage.completionTokens / 1_000_000) * config.outputUsdPer1M;
  const estimatedUsd = inputUsd + outputUsd;

  return {
    model,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    inputUsd,
    outputUsd,
    estimatedUsd,
    persisted: false,
  };
}

/** Log cost estimate to console (stub until Agent E / billing lane wires DB). */
export function logCostEstimate(estimate: CostEstimate): void {
  console.info("[llm:cost]", {
    model: estimate.model,
    tokens: estimate.totalTokens,
    estimatedUsd: estimate.estimatedUsd.toFixed(6),
    persisted: estimate.persisted,
  });
}
