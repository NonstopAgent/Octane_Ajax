import { z } from "zod";
import type { NovaEvaluatedIdea } from "@/lib/ajax/nova/types";
import {
  getPrintifyCatalogEntry,
  PRINTIFY_CATALOG_KEYS,
} from "@/lib/ajax/pod/printify-catalog";
import type { PodDetails } from "@/lib/product/domain";

export const FORGE_PROMPT_VERSION = "forge-pod-catalog-v2";

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
  /**
   * Pre-approved Printify product key. The LLM never outputs raw
   * blueprint/provider/variant IDs — the backend resolves this key against
   * `printify-catalog.ts`, guaranteeing structurally valid Printify calls.
   */
  catalogKey: z.enum(PRINTIFY_CATALOG_KEYS),
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
  /** Proven Etsy search terms (real volume) Forge should prefer in tags/title. */
  marketKeywords?: string[];
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

/**
 * Resolve the LLM's catalogKey to exact, known-good Printify IDs.
 * The persisted PodDetails shape is unchanged — the rest of the pipeline
 * (fulfillment, review UI, sellability) keeps working on real IDs.
 */
export function mapForgePodDetailsToDomain(
  raw: ForgeLlmPodDetails,
  metadata?: Record<string, unknown>,
): PodDetails {
  const entry = getPrintifyCatalogEntry(raw.catalogKey);
  return {
    blueprintId: entry.blueprintId,
    printProviderId: entry.printProviderId,
    variantIds: entry.variantIds,
    artworkPrompt: raw.artworkPrompt.trim(),
    aestheticStyle: raw.aestheticStyle,
    metadata: {
      ...metadata,
      catalogKey: entry.key,
      catalogLabel: entry.label,
    },
  };
}

export function ensureAiDisclosureInCopy(text: string): string {
  if (text.includes(AI_DISCLOSURE_TEXT)) return text;
  return `${text.trim()}\n\n${AI_DISCLOSURE_TEXT}`;
}
