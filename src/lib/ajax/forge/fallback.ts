import type { NovaEvaluatedIdea } from "@/lib/ajax/nova/types";
import {
  AI_DISCLOSURE_TEXT,
  ensureAiDisclosureInCopy,
  mapForgePodDetailsToDomain,
  type ForgeGenerationResult,
} from "@/lib/ajax/forge/types";
import {
  catalogKeyForFormat,
  getPrintifyCatalogEntry,
} from "@/lib/ajax/pod/printify-catalog";

const FALLBACK_AESTHETIC = "minimalist-line-art" as const;

function padSeoTags(keywords: string[], concept: string): string[] {
  const base = [
    ...keywords.map((k) => k.trim()).filter(Boolean),
    "print on demand",
    "gift idea",
    "unique design",
    "custom mug",
    "etsy gift",
    "made to order",
  ];
  const nicheTokens = concept
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 3)
    .slice(0, 4);

  const merged = [...new Set([...base, ...nicheTokens])];
  while (merged.length < 13) {
    merged.push(`tag${merged.length + 1}`);
  }
  return merged.slice(0, 13);
}

/** Deterministic Forge output when LLM is unavailable. */
export function buildForgeFallbackResult(
  idea: NovaEvaluatedIdea,
): ForgeGenerationResult {
  const listingTitle = `${idea.productConcept} — Print-on-Demand Gift`;
  const listingDescription = ensureAiDisclosureInCopy(
    [
      idea.problemSolved,
      "",
      `Designed for: ${idea.targetBuyer}`,
      "",
      "What's included:",
      "- Professionally printed physical product (made to order)",
      "- Original artwork tailored to this niche",
      "- Ships via Printify fulfillment network",
      "",
      idea.reasoning,
    ].join("\n"),
  );

  const catalogKey = catalogKeyForFormat(idea.format);
  const catalogEntry = getPrintifyCatalogEntry(catalogKey);

  const artworkPrompt = `Original ${FALLBACK_AESTHETIC} artwork for ${idea.niche}: ${idea.productConcept}. ${idea.problemSolved}. No copyrighted characters, brands, or logos.`;

  const podDetails = mapForgePodDetailsToDomain(
    {
      catalogKey,
      artworkPrompt,
      aestheticStyle: FALLBACK_AESTHETIC,
    },
    {
      aiDisclosure: AI_DISCLOSURE_TEXT,
      forgeMode: "fallback",
      coverImagePrompt: `Product mockup for ${catalogEntry.label} about ${idea.niche}, soft neutral palette, no logos or characters`,
    },
  );

  return {
    mode: "fallback",
    listingTitle,
    listingDescription,
    seoTags: padSeoTags(idea.keywords, idea.productConcept),
    suggestedPrice: catalogEntry.defaultPriceCents / 100,
    podDetails,
    complianceNotes: [],
    aiDisclosure: AI_DISCLOSURE_TEXT,
    coverImagePrompt: String(podDetails.metadata?.coverImagePrompt ?? ""),
    revisionNotes: ["Deterministic Forge fallback (no LLM)."],
  };
}
