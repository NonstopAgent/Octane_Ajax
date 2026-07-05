import { z } from "zod";
import { completeJson } from "@/lib/llm/json";
import { isOpenAiConfigured } from "@/lib/llm/openai";
import { isProviderConfigured } from "@/lib/llm/providers";
import {
  REVIEW_DIMENSIONS,
  REVIEW_THRESHOLDS,
  type ReviewDimensionKey,
} from "@/lib/ajax/reviewer/playbook";
import {
  buildReviewerSystemPrompt,
  REVIEWER_JSON_INSTRUCTIONS,
} from "@/lib/ajax/reviewer/prompts";
import { heuristicReview } from "@/lib/ajax/reviewer/heuristic";
import { isVisionReviewAvailable, visionReview } from "@/lib/ajax/reviewer/vision";

export type ReviewerInput = {
  title: string;
  description?: string | null;
  price?: number | null;
  tags?: string[];
  niche?: string | null;
  format?: string | null;
  brand?: string;
  /** The shop's niche/positioning (e.g. pet-owner gifts). When set, the reviewer
   * hard-enforces that the listing belongs to this store. */
  storeNiche?: string | null;
  mockupUrls?: string[];
  /** Real market signal for this niche (searches/mo vs competing listings). */
  market?: {
    searchesPerMonth: number | null;
    competingListings: number | null;
    matchedTerm: string | null;
  } | null;
};

export type ReviewVerdict = "approve" | "revise" | "reject";

export type ReviewerResult = {
  verdict: ReviewVerdict;
  overallScore: number;
  subscores: Record<ReviewDimensionKey, number>;
  reasons: string[];
  fixes: string[];
  model: string;
};

const clamp = (n: unknown): number =>
  Math.max(0, Math.min(100, Math.round(Number(n) || 0)));

const ReviewerSchema = z.object({
  subscores: z.object({
    seo: z.union([z.number(), z.string()]),
    sellability: z.union([z.number(), z.string()]),
    brand: z.union([z.number(), z.string()]),
    quality: z.union([z.number(), z.string()]),
    compliance: z.union([z.number(), z.string()]),
  }),
  reasons: z.array(z.string()).optional().default([]),
  fixes: z.array(z.string()).optional().default([]),
  hardBlock: z.boolean().optional().default(false),
  verdictHint: z.string().optional(),
});

export function isReviewerConfigured(): boolean {
  return isProviderConfigured("anthropic") || isOpenAiConfigured();
}

/** Turn subscores into the weighted verdict — shared by the LLM and heuristic paths. */
function finalize(
  subscores: Record<ReviewDimensionKey, number>,
  hardBlock: boolean,
  reasons: string[],
  fixes: string[],
  model: string,
): ReviewerResult {
  const overallScore = Math.round(
    REVIEW_DIMENSIONS.reduce((sum, d) => sum + subscores[d.key] * d.weight, 0),
  );
  let verdict: ReviewVerdict;
  if (hardBlock || subscores.compliance < 40) verdict = "reject";
  else if (overallScore >= REVIEW_THRESHOLDS.autoApprove) verdict = "approve";
  else if (overallScore >= REVIEW_THRESHOLDS.autoReject) verdict = "revise";
  else verdict = "reject";
  return {
    verdict,
    overallScore,
    subscores,
    reasons: reasons.slice(0, 6),
    fixes: fixes.slice(0, 6),
    model,
  };
}

/** A short human-readable market note (real demand vs. supply) for the prompts. */
function formatMarketNote(market: ReviewerInput["market"]): string | null {
  if (!market) return null;
  const d =
    market.searchesPerMonth != null
      ? `~${market.searchesPerMonth}/mo searches`
      : "demand unknown";
  const c =
    market.competingListings != null
      ? `${market.competingListings} competing listings`
      : "supply unknown";
  let tail = "";
  if (market.searchesPerMonth != null && market.competingListings != null) {
    const ratio = market.searchesPerMonth / Math.max(1, market.competingListings);
    tail =
      market.competingListings > 100000 || ratio < 0.05
        ? " — SATURATED red ocean, very hard to rank; be strict"
        : ratio >= 0.3
          ? " — open opportunity"
          : " — moderately competitive";
  }
  return `${market.matchedTerm ? `"${market.matchedTerm}": ` : ""}${d} vs ${c}${tail}`;
}

/**
 * Grades a listing against the proven Etsy playbook. Tries VISION first (actually
 * looks at the mockup via OpenAI), then a text LLM, and ALWAYS falls back to the
 * deterministic heuristic — so the gate returns a verdict even with no key or a
 * slow model, and autopilot never gets stuck. Market-aware throughout.
 */
export async function reviewListing(
  input: ReviewerInput,
): Promise<ReviewerResult> {
  const brand = input.brand?.trim() || "the shop";
  const mockups = (input.mockupUrls ?? []).filter(
    (u) => typeof u === "string" && u.startsWith("https://"),
  );
  const marketNote = formatMarketNote(input.market);
  const payload = {
    title: input.title,
    description: (input.description ?? "").slice(0, 1200),
    price: input.price ?? null,
    tags: input.tags ?? [],
    niche: input.niche ?? null,
    format: input.format ?? null,
    mockupCount: mockups.length,
    mockupUrls: mockups.slice(0, 8),
  };

  // 1) Vision — actually see the mockup. Best signal; returns null on any failure.
  if (isVisionReviewAvailable() && mockups.length > 0) {
    const v = await visionReview({
      brand,
      storeNiche: input.storeNiche,
      payload,
      imageUrl: mockups[0],
      marketNote,
    });
    if (v) return finalize(v.subscores, v.hardBlock, v.reasons, v.fixes, v.model);
  }

  // 2) Text LLM (router — Claude/OpenAI), fast single attempt.
  if (isReviewerConfigured()) {
    try {
      const result = await completeJson({
        task: "strategy",
        schema: ReviewerSchema,
        messages: [
          {
            role: "system",
            content: buildReviewerSystemPrompt(brand, input.storeNiche),
          },
          {
            role: "user",
            content: `LISTING (JSON):\n${JSON.stringify(payload)}${
              marketNote ? `\n\nMARKET: ${marketNote}` : ""
            }`,
          },
        ],
        jsonInstructions: REVIEWER_JSON_INSTRUCTIONS,
        options: { temperature: 0.2, maxTokens: 1200 },
        timeout: 22_000,
        maxRetries: 0,
      });
      const s = result.data.subscores;
      const subscores: Record<ReviewDimensionKey, number> = {
        seo: clamp(s.seo),
        sellability: clamp(s.sellability),
        brand: clamp(s.brand),
        quality: clamp(s.quality),
        compliance: clamp(s.compliance),
      };
      return finalize(
        subscores,
        result.data.hardBlock,
        result.data.reasons,
        result.data.fixes,
        result.model,
      );
    } catch {
      // fall through to the deterministic heuristic
    }
  }

  // 3) Deterministic heuristic (market-aware).
  const h = heuristicReview({
    title: input.title,
    description: input.description,
    price: input.price,
    tags: input.tags,
    mockupUrls: mockups,
    niche: input.niche,
    storeNiche: input.storeNiche,
    market: input.market,
  });
  return finalize(h.subscores, h.hardBlock, h.reasons, h.fixes, "heuristic");
}
