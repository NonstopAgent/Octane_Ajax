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
  mapForgeStructureToDomain,
  type ForgeGenerationInput,
  type ForgeGenerationResult,
  AI_DISCLOSURE_TEXT,
} from "@/lib/ajax/forge/types";
import { completeJson } from "@/lib/llm/json";
import { isOpenAiConfigured } from "@/lib/llm/openai";
import type { ComplianceFlag } from "@/lib/product/domain";

export type ForgeGenerationOptions = {
  client?: OpenAI;
  forceFallback?: boolean;
};

function buildComplianceArtifacts(notes: string[]): {
  flags: ComplianceFlag[];
  warnings: string[];
} {
  const warnings = notes.map((n) => n.trim()).filter(Boolean);
  const flags: ComplianceFlag[] = warnings.map((warning) => ({
    code: "review_note",
    message: warning,
    severity: "warning",
    source: "forge",
  }));
  return { flags, warnings };
}

function mapLlmResponseToResult(
  data: ReturnType<typeof ForgeLlmResponseSchema.parse>,
  model: string,
  usage?: { promptTokens: number; completionTokens: number },
): ForgeGenerationResult {
  const aiDisclosure = data.aiDisclosure.includes(AI_DISCLOSURE_TEXT)
    ? data.aiDisclosure.trim()
    : AI_DISCLOSURE_TEXT;

  const structure = mapForgeStructureToDomain(data.productStructure, {
    aiDisclosure,
    coverImagePrompt: data.coverImagePrompt.trim(),
    seoTags: data.seoTags.map((t) => t.trim()),
    revisionNotes: data.revisionNotes,
    forgeMode: "llm",
  });

  const { warnings } = buildComplianceArtifacts(data.complianceNotes);

  return {
    mode: "llm",
    listingTitle: data.listingTitle.trim(),
    listingDescription: ensureAiDisclosureInCopy(data.listingDescription),
    seoTags: data.seoTags.map((t) => t.trim()),
    suggestedPrice: data.suggestedPrice,
    productStructure: structure,
    complianceNotes: warnings,
    aiDisclosure,
    coverImagePrompt: data.coverImagePrompt.trim(),
    revisionNotes: data.revisionNotes.map((n) => n.trim()).filter(Boolean),
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
        }),
      },
    ],
    schema: ForgeLlmResponseSchema,
    jsonInstructions: FORGE_GENERATION_JSON_INSTRUCTIONS,
    options: { temperature: 0.6, maxTokens: 4000 },
    client: options?.client,
  });

  return mapLlmResponseToResult(result.data, result.model, result.usage);
}

/**
 * Forge generation: LLM when configured, otherwise deterministic fallback.
 * Output is Zod-validated; malformed productStructure is rejected (with retry via completeJson).
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

/** Compliance flags + warnings for persisting on product_generations. */
export function forgeResultToCompliance(result: ForgeGenerationResult): {
  flags: ComplianceFlag[];
  warnings: string[];
} {
  return buildComplianceArtifacts(result.complianceNotes);
}
