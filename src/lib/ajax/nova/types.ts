import { z } from "zod";
import {
  ALLOWED_PRODUCT_CATEGORIES,
  PRODUCT_FORMATS,
} from "@/lib/ajax/product-brain/rules";
import type {
  ProductBrainScore,
  ProductBrainValidation,
  ProductBrainVerdict,
  ProductCategory,
  ProductFormat,
} from "@/lib/ajax/product-brain/types";

export const NOVA_PROMPT_VERSION = "nova-ideation-v1";

export type NovaIdeationMode = "llm" | "fallback";

/** Single idea shape returned by the Nova LLM (before Product Brain). */
export const NovaLlmIdeaSchema = z.object({
  niche: z.string().min(1),
  targetBuyer: z.string().min(1),
  problemSolved: z.string().min(1),
  productConcept: z.string().min(1),
  format: z.string().min(1),
  category: z.string().min(1),
  suggestedPrice: z.number().positive(),
  keywords: z.array(z.string().min(1)).min(1),
  reasoning: z.string().min(1),
});

export type NovaLlmIdea = z.infer<typeof NovaLlmIdeaSchema>;

export const NovaLlmResponseSchema = z.object({
  ideas: z.array(NovaLlmIdeaSchema).min(1).max(5),
});

export type NovaLlmResponse = z.infer<typeof NovaLlmResponseSchema>;

/** Normalized idea before Product Brain evaluation. */
export interface NovaRawIdea {
  niche: string;
  targetBuyer: string;
  problemSolved: string;
  productConcept: string;
  format: ProductFormat;
  category: ProductCategory;
  suggestedPrice: number;
  keywords: string[];
  reasoning: string;
  source: NovaIdeationMode;
}

/** Idea that passed Product Brain and is eligible for persistence. */
export interface NovaEvaluatedIdea extends NovaRawIdea {
  score: ProductBrainScore;
  validation: ProductBrainValidation;
  verdict: ProductBrainVerdict;
  trendScore: number;
  llmModel?: string;
}

export type NovaIdeationResult = {
  mode: NovaIdeationMode;
  ideas: NovaEvaluatedIdea[];
  llmModel?: string;
  promptVersion: string;
};

const FORMAT_ALIASES: Record<string, ProductFormat> = {
  planners: "planner",
  plan: "planner",
  trackers: "tracker",
  track: "tracker",
  worksheets: "worksheet",
  sheet: "worksheet",
  checklists: "checklist",
  list: "checklist",
  templates: "template",
  logbooks: "logbook",
  journal: "logbook",
  bundles: "bundle",
  kit: "bundle",
};

const CATEGORY_ALIASES: Record<string, ProductCategory> = {
  education: "education",
  productivity: "productivity",
  small_business: "small_business",
  "small business": "small_business",
  home_organization: "home_organization",
  "home organization": "home_organization",
  wellness_tracking: "wellness_tracking",
  wellness: "wellness_tracking",
  parenting_support: "parenting_support",
  parenting: "parenting_support",
  student_tools: "student_tools",
  students: "student_tools",
  creator_tools: "creator_tools",
  creators: "creator_tools",
};

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

/** Map LLM string labels to Product Brain format enum. */
export function normalizeProductFormat(value: string): ProductFormat {
  const token = normalizeToken(value);
  if ((PRODUCT_FORMATS as readonly string[]).includes(token)) {
    return token as ProductFormat;
  }
  return FORMAT_ALIASES[token] ?? "planner";
}

/** Map LLM string labels to Product Brain category enum. */
export function normalizeProductCategory(value: string): ProductCategory {
  const token = normalizeToken(value);
  if ((ALLOWED_PRODUCT_CATEGORIES as readonly string[]).includes(token)) {
    return token as ProductCategory;
  }
  return CATEGORY_ALIASES[token] ?? "productivity";
}

export function mapLlmIdeaToRaw(
  idea: NovaLlmIdea,
  source: NovaIdeationMode = "llm",
): NovaRawIdea {
  return {
    niche: idea.niche.trim(),
    targetBuyer: idea.targetBuyer.trim(),
    problemSolved: idea.problemSolved.trim(),
    productConcept: idea.productConcept.trim(),
    format: normalizeProductFormat(idea.format),
    category: normalizeProductCategory(idea.category),
    suggestedPrice: idea.suggestedPrice,
    keywords: idea.keywords.map((k) => k.trim()).filter(Boolean),
    reasoning: idea.reasoning.trim(),
    source,
  };
}
