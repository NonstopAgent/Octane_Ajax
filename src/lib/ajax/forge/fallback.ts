import type { NovaEvaluatedIdea } from "@/lib/ajax/nova/types";
import {
  AI_DISCLOSURE_TEXT,
  ensureAiDisclosureInCopy,
  mapForgePodDetailsToDomain,
  type ForgeGenerationResult,
  type ForgeLlmPodDetails,
} from "@/lib/ajax/forge/types";

const FALLBACK_PRICE = 19.99;

/** Default Printify mug blueprint for deterministic fallback (demo-safe). */
const FALLBACK_POD: ForgeLlmPodDetails = {
  blueprintId: 68,
  printProviderId: 1,
  variantIds: [33719, 33720],
  artworkPrompt:
    "Minimal flat illustration with soft neutral palette, niche-specific iconography, no logos, no characters, print-ready centered composition",
  aestheticStyle: "minimalist-line-art",
};

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

  const artworkPrompt = `Original ${FALLBACK_POD.aestheticStyle} artwork for ${idea.niche}: ${idea.productConcept}. ${idea.problemSolved}. No copyrighted characters, brands, or logos.`;

  const podDetails = mapForgePodDetailsToDomain(
    {
      ...FALLBACK_POD,
      artworkPrompt,
    },
    {
      aiDisclosure: AI_DISCLOSURE_TEXT,
      forgeMode: "fallback",
      coverImagePrompt: `Product mockup for ${idea.format} about ${idea.niche}, soft neutral palette, no logos or characters`,
    },
  );

  return {
    mode: "fallback",
    listingTitle,
    listingDescription,
    seoTags: padSeoTags(idea.keywords, idea.productConcept),
    suggestedPrice: FALLBACK_PRICE,
    podDetails,
    complianceNotes: [],
    aiDisclosure: AI_DISCLOSURE_TEXT,
    coverImagePrompt: String(podDetails.metadata?.coverImagePrompt ?? ""),
    revisionNotes: ["Deterministic Forge fallback (no LLM)."],
  };
}
