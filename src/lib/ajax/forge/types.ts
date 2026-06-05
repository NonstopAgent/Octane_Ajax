import { z } from "zod";
import type { NovaEvaluatedIdea } from "@/lib/ajax/nova/types";
import type { PodDetails } from "@/lib/product/domain";

export const FORGE_PROMPT_VERSION = "forge-pod-v1";

export const AI_DISCLOSURE_TEXT =
  "AI tools assisted in drafting and structuring this product. The seller reviewed and customized the final listing.";

/** IP-safe aesthetic styles — no copyrighted character or brand references. */
export const IP_SAFE_AESTHETIC_STYLES = [
  "minimalist-line-art",
  "watercolor-botanical",
  "retro-geometric",
  "modern-typography",
  "soft-pastel-illustration",
  "bold-mono-graphic",
  "vintage-engraving",
  "abstract-shapes",
  "nature-sketch",
  "clean-flat-vector",
] as const;

export type IpSafeAestheticStyle = (typeof IP_SAFE_AESTHETIC_STYLES)[number];

export type ForgeGenerationMode = "llm" | "fallback";

export const ForgePodDetailsSchema = z.object({
  blueprintId: z.number().int().positive(),
  printProviderId: z.number().int().positive(),
  variantIds: z.array(z.number().int().positive()).min(1).max(20),
  artworkPrompt: z.string().min(20),
  aestheticStyle: z.enum(IP_SAFE_AESTHETIC_STYLES),
});

export type ForgeLlmPodDetails = z.infer<typeof ForgePodDetailsSchema>;

export const ForgeLlmResponseSchema = z.object({
  listingTitle: z.string().min(1),
  listingDescription: z.string().min(1),
  seoTags: z.array(z.string().min(1)).length(13),
  suggestedPrice: z.number().positive().max(149.99),
  podDetails: ForgePodDetailsSchema,
  complianceNotes: z.array(z.string()),
  aiDisclosure: z.string().min(1),
  coverImagePrompt: z.string().min(1),
  revisionNotes: z.array(z.string()),
});

export type ForgeLlmResponse = z.infer<typeof ForgeLlmResponseSchema>;

export type ForgeGenerationInput = {
  runId: string;
  idea: NovaEvaluatedIdea;
};

export type ForgeGenerationResult = {
  mode: ForgeGenerationMode;
  listingTitle: string;
  listingDescription: string;
  seoTags: string[];
  suggestedPrice: number;
  podDetails: PodDetails;
  complianceNotes: string[];
  aiDisclosure: string;
  coverImagePrompt: string;
  revisionNotes: string[];
  /** Set when {@link ForgeGenerationMode} is `llm` (e.g. `openai`). */
  llmProvider?: string;
  llmModel?: string;
  promptVersion?: string;
  tokenEstimateInput?: number;
  tokenEstimateOutput?: number;
};

export function mapForgePodDetailsToDomain(
  raw: ForgeLlmPodDetails,
  metadata?: Record<string, unknown>,
): PodDetails {
  return {
    blueprintId: raw.blueprintId,
    printProviderId: raw.printProviderId,
    variantIds: raw.variantIds,
    artworkPrompt: raw.artworkPrompt.trim(),
    aestheticStyle: raw.aestheticStyle,
    metadata,
  };
}

export function ensureAiDisclosureInCopy(text: string): string {
  if (text.includes(AI_DISCLOSURE_TEXT)) return text;
  return `${text.trim()}\n\n${AI_DISCLOSURE_TEXT}`;
}
