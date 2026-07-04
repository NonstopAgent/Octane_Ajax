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

/** Grades a listing against the proven Etsy playbook and returns a verdict. */
export async function reviewListing(
  input: ReviewerInput,
): Promise<ReviewerResult> {
  const brand = input.brand?.trim() || "the shop";
  const mockups = (input.mockupUrls ?? []).filter(
    (u) => typeof u === "string" && u.startsWith("https://"),
  );
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

  const result = await completeJson({
    task: "strategy",
    schema: ReviewerSchema,
    messages: [
      {
        role: "system",
        content: buildReviewerSystemPrompt(brand, input.storeNiche),
      },
      { role: "user", content: `LISTING (JSON):\n${JSON.stringify(payload)}` },
    ],
    jsonInstructions: REVIEWER_JSON_INSTRUCTIONS,
    options: { temperature: 0.2, maxTokens: 1200 },
    timeout: 30_000,
    maxRetries: 1,
  });

  const s = result.data.subscores;
  const subscores: Record<ReviewDimensionKey, number> = {
    seo: clamp(s.seo),
    sellability: clamp(s.sellability),
    brand: clamp(s.brand),
    quality: clamp(s.quality),
    compliance: clamp(s.compliance),
  };

  const overallScore = Math.round(
    REVIEW_DIMENSIONS.reduce(
      (sum, d) => sum + subscores[d.key] * d.weight,
      0,
    ),
  );

  let verdict: ReviewVerdict;
  if (result.data.hardBlock || subscores.compliance < 40) {
    verdict = "reject";
  } else if (overallScore >= REVIEW_THRESHOLDS.autoApprove) {
    verdict = "approve";
  } else if (overallScore >= REVIEW_THRESHOLDS.autoReject) {
    verdict = "revise";
  } else {
    verdict = "reject";
  }

  return {
    verdict,
    overallScore,
    subscores,
    reasons: result.data.reasons.slice(0, 6),
    fixes: result.data.fixes.slice(0, 6),
    model: result.model,
  };
}
