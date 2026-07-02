import type OpenAI from "openai";
import {
  buildForgeFallbackResult,
} from "@/lib/ajax/forge/fallback";
import {
  buildForgeGenerationUserPrompt,
  FORGE_GENERATION_JSON_INSTRUCTIONS,
  FORGE_GENERATION_SYSTEM_PROMPT,
  FORGE_PROMPT_VERSION,
} from "@/lib/ajax/forge/prompts";
import {
  ensureAiDisclosureInCopy,
  ForgeLlmResponseSchema,
  mapForgePodDetailsToDomain,
  type ForgeGenerationInput,
  type ForgeGenerationResult,
  AI_DISCLOSURE_TEXT,
} from "@/lib/ajax/forge/types";
import { completeJson } from "@/lib/llm/json";
import { isOpenAiConfigured } from "@/lib/llm/openai";
import type { LlmRunMetadata } from "@/lib/product/domain";

export const FORGE_LLM_PROVIDER = "openai" as const;

export type ForgeGenerationOptions = {
  client?: OpenAI;
  forceFallback?: boolean;
};

/** POD retail price guardrails (USD). */
export function guardrailedPrice(suggestedPrice: number): number {
  if (suggestedPrice < 9.99) return 9.99;
  if (suggestedPrice > 149.99) return 49.99;
  return suggestedPrice;
}

function mapLlmResponseToResult(
  data: ReturnType<typeof ForgeLlmResponseSchema.parse>,
  model: string,
  usage?: { promptTokens: number; completionTokens: number },
): ForgeGenerationResult {
  const aiDisclosure = data.aiDisclosure.includes(AI_DISCLOSURE_TEXT)
    ? data.aiDisclosure.trim()
    : AI_DISCLOSURE_TEXT;

  const podDetails = mapForgePodDetailsToDomain(data.podDetails, {
    aiDisclosure,
    coverImagePrompt: data.coverImagePrompt.trim(),
    seoTags: data.seoTags.map((t) => t.trim()),
    revisionNotes: data.revisionNotes,
    forgeMode: "llm",
  });

  const complianceNotes = data.complianceNotes
    .map((n) => n.trim())
    .filter(Boolean);

  return {
    mode: "llm",
    listingTitle: data.listingTitle.trim(),
    listingDescription: ensureAiDisclosureInCopy(data.listingDescription),
    seoTags: data.seoTags.map((t) => t.trim()),
    suggestedPrice: guardrailedPrice(data.suggestedPrice),
    podDetails,
    complianceNotes,
    aiDisclosure,
    coverImagePrompt: data.coverImagePrompt.trim(),
    revisionNotes: data.revisionNotes.map((n) => n.trim()).filter(Boolean),
    llmProvider: FORGE_LLM_PROVIDER,
    llmModel: model,
    promptVersion: FORGE_PROMPT_VERSION,
    tokenEstimateInput: usage?.promptTokens,
    tokenEstimateOutput: usage?.completionTokens,
  };
}

async function fetchLlmForgeOutput(
  input: ForgeGenerationInput,
  options?: ForgeGenerationOptions,
): Promise<ForgeGenerationResult> {
  const { idea, runId } = input;
  const result = await completeJson({
    messages: [
      { role: "system", content: FORGE_GENERATION_SYSTEM_PROMPT },
      {
        role: "user",
        content: buildForgeGenerationUserPrompt({
          runId,
          niche: idea.niche,
          targetBuyer: idea.targetBuyer,
          problemSolved: idea.problemSolved,
          productConcept: idea.productConcept,
          format: idea.format,
          category: idea.category,
          suggestedPrice: idea.suggestedPrice,
          keywords: idea.keywords,
          reasoning: idea.reasoning,
          marketKeywords: input.marketKeywords,
        }),
      },
    ],
    schema: ForgeLlmResponseSchema,
    jsonInstructions: FORGE_GENERATION_JSON_INSTRUCTIONS,
    options: { temperature: 0.6, maxTokens: 4000 },
    timeout: 28_000,
    client: options?.client,
  });

  return mapLlmResponseToResult(result.data, result.model, result.usage);
}

/**
 * Forge generation: LLM when configured, otherwise deterministic fallback.
 * Output is Zod-validated; malformed podDetails is rejected (with retry via completeJson).
 */
export async function runForgeGeneration(
  input: ForgeGenerationInput,
  options?: ForgeGenerationOptions,
): Promise<ForgeGenerationResult> {
  const useLlm =
    !options?.forceFallback &&
    (options?.client != null || isOpenAiConfigured());

  if (useLlm) {
    try {
      return await fetchLlmForgeOutput(input, options);
    } catch {
      // LLM failure → deterministic fallback (demo continuity)
    }
  }

  return buildForgeFallbackResult(input.idea);
}

/**
 * Persisted compliance on product_generations — policy risks only.
 * Forge review notes live on {@link ForgeGenerationResult.complianceNotes} and factory events.
 */
export function forgeResultToCompliance(_result: ForgeGenerationResult): {
  flags: [];
  warnings: [];
} {
  return { flags: [], warnings: [] };
}

/** Maps a Forge run to `product_generations` LLM columns (populated only for real LLM runs). */
export function forgeResultToGenerationLlm(
  result: ForgeGenerationResult,
): LlmRunMetadata {
  if (result.mode !== "llm") {
    return {
      provider: null,
      model: null,
      promptVersion: null,
      tokenEstimateInput: null,
      tokenEstimateOutput: null,
    };
  }

  return {
    provider: result.llmProvider ?? FORGE_LLM_PROVIDER,
    model: result.llmModel ?? null,
    promptVersion: result.promptVersion ?? FORGE_PROMPT_VERSION,
    tokenEstimateInput: result.tokenEstimateInput ?? null,
    tokenEstimateOutput: result.tokenEstimateOutput ?? null,
  };
}
