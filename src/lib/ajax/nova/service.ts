import type OpenAI from "openai";
import {
  getProductBrainVerdict,
  scoreProductIdea,
  validateProductIdea,
} from "@/lib/ajax/product-brain";
import type { ProductBrainInput } from "@/lib/ajax/product-brain/types";
import { mapFakeDraftsToNovaRaw } from "@/lib/ajax/nova/fallback";
import type { NovaPastContext } from "@/lib/ajax/nova/past-context";
import {
  buildNovaIdeationUserPrompt,
  NOVA_IDEATION_JSON_INSTRUCTIONS,
  NOVA_IDEATION_SYSTEM_PROMPT,
  NOVA_PROMPT_VERSION,
} from "@/lib/ajax/nova/prompts";
import {
  mapLlmIdeaToRaw,
  NovaLlmResponseSchema,
  type NovaEvaluatedIdea,
  type NovaIdeationResult,
  type NovaRawIdea,
} from "@/lib/ajax/nova/types";
import type { EtsyMarketContext } from "@/lib/ajax/nova/etsy-research";
import { completeJson } from "@/lib/llm/json";
import { isOpenAiConfigured } from "@/lib/llm/openai";
import type { Json } from "@/lib/supabase/database.types";
import { mapIdeaBrainToDbUpdate } from "@/lib/product/mappers";
import type { ProductIdeaBrainSnapshot } from "@/lib/product/domain";
import type { TablesInsert } from "@/lib/supabase/database.types";

const NEEDS_REVISION_TREND_PENALTY = 12;

export type NovaIdeationOptions = {
  /** Inject mock OpenAI client in tests. */
  client?: OpenAI;
  /** Force deterministic fallback (e.g. missing key tests). */
  forceFallback?: boolean;
  /** Operator history from past cycles (rejected/approved niches, recent titles). */
  pastContext?: NovaPastContext;
  /** Live Etsy market data to ground ideation (passed through from simulator). */
  marketContext?: EtsyMarketContext;
};

function toBrainInput(raw: NovaRawIdea): ProductBrainInput {
  return {
    title: raw.productConcept,
    niche: raw.niche,
    targetBuyer: raw.targetBuyer,
    problemSolved: raw.problemSolved,
    format: raw.format,
    category: raw.category,
    description: [raw.problemSolved, raw.reasoning].filter(Boolean).join(" "),
    keywords: raw.keywords,
  };
}

function computeTrendScore(
  score: NovaEvaluatedIdea["score"],
  verdict: NovaEvaluatedIdea["verdict"],
): number {
  const base = Math.round(score.totalScore);
  if (verdict === "needs_revision") {
    return Math.max(0, base - NEEDS_REVISION_TREND_PENALTY);
  }
  return base;
}

function evaluateRawIdea(
  raw: NovaRawIdea,
  llmModel?: string,
): NovaEvaluatedIdea | null {
  const input = toBrainInput(raw);
  const score = scoreProductIdea(input);
  const validation = validateProductIdea(input);
  const verdict = getProductBrainVerdict(score, validation);

  if (verdict === "blocked") {
    return null;
  }

  return {
    ...raw,
    score,
    validation,
    verdict,
    trendScore: computeTrendScore(score, verdict),
    llmModel,
  };
}

function evaluateRawIdeas(
  rawIdeas: NovaRawIdea[],
  llmModel?: string,
): NovaEvaluatedIdea[] {
  const evaluated: NovaEvaluatedIdea[] = [];
  for (const raw of rawIdeas) {
    const idea = evaluateRawIdea(raw, llmModel);
    if (idea) evaluated.push(idea);
  }
  return evaluated;
}

async function fetchLlmRawIdeas(
  runId: string,
  options?: NovaIdeationOptions,
): Promise<{ raw: NovaRawIdea[]; model: string }> {
  const result = await completeJson({
    task: "ideation",
    messages: [
      { role: "system", content: NOVA_IDEATION_SYSTEM_PROMPT },
      {
        role: "user",
        content: buildNovaIdeationUserPrompt(runId, options?.pastContext, options?.marketContext),
      },
    ],
    schema: NovaLlmResponseSchema,
    jsonInstructions: NOVA_IDEATION_JSON_INSTRUCTIONS,
    options: { temperature: 0.7, maxTokens: 2500 },
    client: options?.client,
  });

  return {
    raw: result.data.ideas.map((idea) => mapLlmIdeaToRaw(idea, "llm")),
    model: result.model,
  };
}

/**
 * Nova ideation: LLM when configured, otherwise deterministic fallback.
 * Product Brain filters blocked ideas; if LLM yields none eligible, falls back to demo catalog.
 */
export async function runNovaIdeation(
  runId: string,
  options?: NovaIdeationOptions,
): Promise<NovaIdeationResult> {
  const useLlm =
    !options?.forceFallback && (options?.client != null || isOpenAiConfigured());

  if (useLlm) {
    try {
      const { raw, model } = await fetchLlmRawIdeas(runId, options);
      let ideas = evaluateRawIdeas(raw, model);

      if (ideas.length === 0) {
        ideas = evaluateRawIdeas(mapFakeDraftsToNovaRaw(runId));
        return {
          mode: "fallback",
          ideas,
          promptVersion: NOVA_PROMPT_VERSION,
        };
      }

      return {
        mode: "llm",
        ideas,
        llmModel: model,
        promptVersion: NOVA_PROMPT_VERSION,
      };
    } catch {
      // LLM failure → deterministic fallback (demo continuity)
    }
  }

  const ideas = evaluateRawIdeas(mapFakeDraftsToNovaRaw(runId));
  if (ideas.length === 0) {
    throw new Error(
      "Nova ideation produced no ideas that passed Product Brain. Check demo fallback catalog.",
    );
  }

  return {
    mode: "fallback",
    ideas,
    promptVersion: NOVA_PROMPT_VERSION,
  };
}

/** Prefer approved ideas; safe needs_revision only if none approved; never blocked. */
export function pickForgeIdeaCandidate<
  T extends {
    verdict: NovaEvaluatedIdea["verdict"];
    trendScore: number;
    validation: NovaEvaluatedIdea["validation"];
  },
>(ideas: T[]): T {
  const eligible = ideas.filter((i) => i.verdict !== "blocked");
  const approved = eligible.filter(
    (i) => i.verdict === "approve_for_generation",
  );
  const pool =
    approved.length > 0
      ? approved
      : eligible.filter(
          (i) =>
            i.verdict === "needs_revision" &&
            i.validation.riskLevel === "safe",
        );

  if (pool.length === 0) {
    throw new Error("No Forge-eligible ideas after Product Brain filtering.");
  }

  return pool.reduce((best, row) =>
    row.trendScore > best.trendScore ? row : best,
  );
}

function buildIdeaDescription(idea: NovaEvaluatedIdea): string {
  return [
    idea.problemSolved,
    `Target buyer: ${idea.targetBuyer}`,
    idea.reasoning,
  ].join("\n\n");
}

/** Map evaluated Nova ideas to `product_ideas` insert rows (includes Product Brain columns). */
export function mapNovaIdeasToDbInserts(
  userId: string,
  runId: string,
  result: NovaIdeationResult,
): TablesInsert<"product_ideas">[] {
  return result.ideas.map((idea) => {
    const evaluatedAt = new Date().toISOString();
    const brainSnapshot: ProductIdeaBrainSnapshot = {
      score: idea.score,
      validation: idea.validation,
      verdict: idea.verdict,
      evaluatedAt,
    };

    const rawPayload: Record<string, unknown> = {
      runId,
      ideationMode: result.mode,
      promptVersion: result.promptVersion,
      targetBuyer: idea.targetBuyer,
      problemSolved: idea.problemSolved,
      format: idea.format,
      category: idea.category,
      suggestedPrice: idea.suggestedPrice,
      reasoning: idea.reasoning,
      source: idea.source,
    };

    if (result.mode === "llm" && result.llmModel) {
      rawPayload.llmModel = result.llmModel;
    }
    if (result.mode === "fallback") {
      rawPayload.simulated = true;
    }

    return {
      user_id: userId,
      source: "nova",
      niche: idea.niche,
      title: idea.productConcept,
      description: buildIdeaDescription(idea),
      seo_keywords: idea.keywords,
      trend_score: idea.trendScore,
      status: "idea",
      raw_payload: rawPayload as Json,
      ...mapIdeaBrainToDbUpdate(brainSnapshot),
    };
  });
}