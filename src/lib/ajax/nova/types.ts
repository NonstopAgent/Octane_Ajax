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
import type { MarketOpportunity } from "@/lib/ajax/product-brain/market-signals";

export const NOVA_PROMPT_VERSION = "nova-ideation-pet-v4";

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
  /** Data-backed market opportunity (present when market signals were evaluated). */
  market?: MarketOpportunity;
  llmModel?: string;
}

export type NovaIdeationResult = {
  mode: NovaIdeationMode;
  ideas: NovaEvaluatedIdea[];
  llmModel?: string;
  promptVersion: string;
};

const FORMAT_ALIASES: Record<string, ProductFormat> = {
  mugs: "mug",
  coffee_mug: "mug",
  cup: "mug",
  posters: "poster",
  wall_art: "poster",
  art_prints: "art_print",
  print: "art_print",
  prints: "art_print",
  canvas: "art_print",
  illustration: "art_print",
  tshirts: "tshirt",
  "t-shirt": "tshirt",
  t_shirt: "tshirt",
  tee: "tshirt",
  shirt: "tshirt",
  apparel: "tshirt",
  sweatshirts: "sweatshirt",
  hoodie: "sweatshirt",
  crewneck: "sweatshirt",
  tote: "tote_bag",
  totes: "tote_bag",
  bag: "tote_bag",
  phone_cases: "phone_case",
  case: "phone_case",
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
  pet_lovers: "pet_lovers",
  pets: "pet_lovers",
  pet: "pet_lovers",
  occupation_gifts: "occupation_gifts",
  occupation: "occupation_gifts",
  profession: "occupation_gifts",
  hobby_leisure: "hobby_leisure",
  hobby: "hobby_leisure",
  hobbies: "hobby_leisure",
  leisure: "hobby_leisure",
  humor_novelty: "humor_novelty",
  humor: "humor_novelty",
  novelty: "humor_novelty",
  funny: "humor_novelty",
  seasonal_holiday: "seasonal_holiday",
  seasonal: "seasonal_holiday",
  holiday: "seasonal_holiday",
  gifts: "hobby_leisure",
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
  return FORMAT_ALIASES[token] ?? "mug";
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
