import { z } from "zod";
import type { NovaEvaluatedIdea } from "@/lib/ajax/nova/types";
import {
  getPrintifyCatalogEntry,
  PRINTIFY_CATALOG_KEYS,
  type PrintifyCatalogKey,
} from "@/lib/ajax/pod/printify-catalog";
import type { PodDetails } from "@/lib/product/domain";

export const FORGE_PROMPT_VERSION = "forge-pod-catalog-v4";

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

// ---------------------------------------------------------------------------
// Product-type guard — the listing copy must name the product actually made.
//
// Root cause this fixes: an idea like "Custom Pet Portrait Tote Bag" resolves
// to a catalog product we CAN fulfill (mug/tee/...), but the LLM (and the
// fallback) kept the original product word in the title — so Etsy showed a
// "Tote Bag" listing whose real product was a t-shirt. The guard rewrites any
// wrong product-type word to the catalog entry's canonical name and appends
// the product name when the title omits it entirely.
// ---------------------------------------------------------------------------

const ETSY_TITLE_MAX_CHARS = 140;

type ProductTypeLexiconEntry = {
  /** Canonical product word for titles ("Mug", "T-Shirt", ...). */
  canonical: string;
  /** Words that legitimately name this product. */
  accepted: RegExp;
};

const PRODUCT_TYPE_LEXICON: Record<PrintifyCatalogKey, ProductTypeLexiconEntry> = {
  MUG_11OZ: {
    canonical: "Mug",
    accepted: /\bmugs?\b|\bcups?\b/i,
  },
  POSTER_MATTE_VERTICAL: {
    canonical: "Poster",
    accepted: /\bposters?\b|\bart\s+prints?\b|\bprints?\b|\bwall\s+art\b/i,
  },
  TEE_UNISEX: {
    canonical: "T-Shirt",
    accepted: /\bt[\s-]?shirts?\b|\btees?\b|\bshirts?\b/i,
  },
  SWEATSHIRT_CREWNECK: {
    canonical: "Sweatshirt",
    accepted: /\bsweatshirts?\b|\bcrewnecks?\b/i,
  },
};

/**
 * Product words that are WRONG unless the catalog key is in `except`.
 * Includes product types the shop cannot make at all (tote bags, phone
 * cases, stickers, hoodies) and cross-type words (a "mug" title on a tee).
 */
const WRONG_TYPE_PATTERNS: {
  pattern: RegExp;
  except: readonly PrintifyCatalogKey[];
}[] = [
  { pattern: /\btote\s*bags?\b|\btotes?\b/gi, except: [] },
  { pattern: /\bphone\s*cases?\b/gi, except: [] },
  { pattern: /\bstickers?\b/gi, except: [] },
  { pattern: /\bhoodies?\b/gi, except: [] }, // crewneck sweatshirt ≠ hoodie
  { pattern: /\bcanvas(?:es)?\b/gi, except: [] },
  { pattern: /\btumblers?\b/gi, except: [] },
  { pattern: /\bornaments?\b/gi, except: [] },
  { pattern: /\bblankets?\b/gi, except: [] },
  { pattern: /\bpillows?\b/gi, except: [] },
  { pattern: /\bmugs?\b/gi, except: ["MUG_11OZ"] },
  { pattern: /\bposters?\b/gi, except: ["POSTER_MATTE_VERTICAL"] },
  { pattern: /\bart\s+prints?\b|\bwall\s+art\b/gi, except: ["POSTER_MATTE_VERTICAL"] },
  { pattern: /\bt[\s-]?shirts?\b|\btees?\b/gi, except: ["TEE_UNISEX"] },
  { pattern: /\bsweatshirts?\b|\bcrewnecks?\b/gi, except: ["SWEATSHIRT_CREWNECK"] },
];

export type ReconciledListingCopy = {
  title: string;
  description: string;
  /** True when the guard had to rewrite or append anything. */
  changed: boolean;
};

function replaceWrongTypeWords(
  text: string,
  catalogKey: PrintifyCatalogKey,
  canonical: string,
): string {
  let out = text;
  for (const { pattern, except } of WRONG_TYPE_PATTERNS) {
    if (except.includes(catalogKey)) continue;
    pattern.lastIndex = 0;
    out = out.replace(pattern, canonical);
  }
  return out;
}

/**
 * Force the listing title/description to name the catalog product being made.
 * Deterministic and idempotent — safe on both LLM and fallback output.
 */
export function reconcileListingCopyWithProduct(
  copy: { title: string; description: string },
  catalogKey: PrintifyCatalogKey,
): ReconciledListingCopy {
  const lexicon = PRODUCT_TYPE_LEXICON[catalogKey];

  let title = replaceWrongTypeWords(copy.title, catalogKey, lexicon.canonical);
  const description = replaceWrongTypeWords(
    copy.description,
    catalogKey,
    lexicon.canonical,
  );

  if (!lexicon.accepted.test(title)) {
    const appended = `${title.trim()} ${lexicon.canonical}`;
    title =
      appended.length <= ETSY_TITLE_MAX_CHARS
        ? appended
        : `${title.trim().slice(0, ETSY_TITLE_MAX_CHARS - lexicon.canonical.length - 2).trimEnd()} ${lexicon.canonical}`;
  }

  return {
    title,
    description,
    changed: title !== copy.title || description !== copy.description,
  };
}
