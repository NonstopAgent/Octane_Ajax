/**
 * Persists per-call LLM token usage + estimated cost to `llm_usage_log`.
 * Server-only and best-effort: never throws, so a logging failure can never
 * break an agent run. The dashboard reads weekly totals from this table.
 */
import { estimateCompletionCost } from "@/lib/llm/cost";
import type { LlmTokenUsage } from "@/lib/llm/types";
import { TABLES } from "@/lib/supabase/schema";
import { createServiceClient } from "@/lib/supabase/server";

export type LlmUsageEntry = {
  task?: string | null;
  provider: string;
  model: string;
  usage: LlmTokenUsage;
};

export async function logLlmUsage(entry: LlmUsageEntry): Promise<void> {
  try {
    const cost = estimateCompletionCost(entry.usage, entry.model);
    const supabase = createServiceClient();
    await supabase.from(TABLES.LLM_USAGE).insert({
      task: entry.task ?? null,
      provider: entry.provider,
      model: entry.model,
      prompt_tokens: entry.usage.promptTokens,
      completion_tokens: entry.usage.completionTokens,
      total_tokens: entry.usage.totalTokens,
      cost_usd: cost.estimatedUsd,
    });
  } catch (error) {
    console.warn(
      "[llm:usage] failed to log usage:",
      error instanceof Error ? error.message : error,
    );
  }
}
