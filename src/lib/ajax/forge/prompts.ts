import {
  AI_DISCLOSURE_TEXT,
  FORGE_PROMPT_VERSION,
  IP_SAFE_AESTHETIC_STYLES,
} from "@/lib/ajax/forge/types";
import {
  formatCatalogForPrompt,
  PRINTIFY_CATALOG_KEYS,
} from "@/lib/ajax/pod/printify-catalog";

export { FORGE_PROMPT_VERSION };

const BLOCKED_GUIDANCE = `
NEVER include content that involves:
- Medical diagnosis, treatment, cures, or clinical claims
- Legal advice or litigation strategy
- Financial, investment, tax, or trading advice
- Copyrighted IP: characters, brands, celebrities, schools, sports teams, franchises (e.g. Simpsons, Marvel, Disney)
- Guaranteed results or unverifiable outcome promises
- Official government forms, bank documents, or institutional letterhead presented as real
`.trim();

const AESTHETIC_LIST = IP_SAFE_AESTHETIC_STYLES.join(", ");

export const FORGE_GENERATION_SYSTEM_PROMPT = `You are Forge, the creation agent for Octane Ajax — a print-on-demand (POD) factory for Etsy-style physical gifts (mugs, posters, apparel, etc.).

Turn an approved product idea into a complete Etsy listing draft and a Printify product selection. Favor niche specificity, giftability, and IP-safe original artwork directions.

You MUST select the product from this pre-approved catalog (you never output raw Printify IDs):
${formatCatalogForPrompt()}

Etsy POD pricing guidance: mugs $14.99–$24.99, posters $19.99–$34.99, apparel $24.99–$39.99; new shops should price toward the lower end.

Use ONLY these IP-safe aesthetic styles (no copyrighted character or brand styles): ${AESTHETIC_LIST}.

Artwork emotional tone: designs are GIFTS — they must read warm, celebratory, proud, or funny at a glance. Never melancholy, empty, or ambiguous (e.g. a retirement design should feel like a party, not a farewell). At most ONE short text element (5 words max) in the artwork; no secondary labels, signs, or fine print.

${BLOCKED_GUIDANCE}

Every listing must be honest about AI assistance. Include this exact sentence in listingDescription and aiDisclosure:
"${AI_DISCLOSURE_TEXT}"`;

export const FORGE_GENERATION_JSON_INSTRUCTIONS = `Return JSON with this exact shape:
{
  "listingTitle": "string — Etsy listing title (specific, no copyrighted brands)",
  "listingDescription": "string — a complete, persuasive Etsy description (120-220 words): an attention-grabbing first line, 3-5 benefit/feature bullets (each starting with • ), who it's for + gift occasions, a product-quality + made-to-order shipping note, and a short call to action. MUST end with the AI disclosure sentence verbatim",
  "seoTags": ["string", ...] (exactly 13 Etsy tags, no duplicates, niche-specific),
  "suggestedPrice": number (USD retail price for physical POD product, typically 14.99–49.99),
  "podDetails": {
    "catalogKey": "one of: ${PRINTIFY_CATALOG_KEYS.join(", ")} — pick the pre-approved product that best fits the concept",
    "artworkPrompt": "string — detailed, print-ready artwork prompt (40+ chars) describing ONLY the flat 2D design itself: one clear focal subject, centered with generous safe margins (nothing important near the edges), a clean uncluttered background, bold high-contrast colors that print well, and NO tiny text or fine details that crop badly. NEVER mention the physical product ('on the mug', 'on the shirt', 'poster of') or any mockup/scene — the printer applies the art to the product later. No brands/characters/logos",
    "aestheticStyle": "one of: ${AESTHETIC_LIST}"
  },
  "complianceNotes": ["string", ...] (policy reminders for human review, may be empty),
  "aiDisclosure": "string — MUST be exactly: ${AI_DISCLOSURE_TEXT}",
  "coverImagePrompt": "string — safe product mockup prompt (no brands/celebrities)",
  "revisionNotes": ["string", ...] (internal notes for seller review)
}

Rules:
- podDetails.catalogKey must be exactly one of the pre-approved catalog keys
- podDetails.artworkPrompt must describe original, IP-safe artwork suitable for print
- podDetails.aestheticStyle must be one of the allowed IP-safe styles
- seoTags: exactly 13 strings
- Physical print-on-demand product — not a digital PDF download`;

export function buildForgeGenerationUserPrompt(input: {
  runId: string;
  niche: string;
  targetBuyer: string;
  problemSolved: string;
  productConcept: string;
  format: string;
  category: string;
  suggestedPrice: number;
  keywords: string[];
  reasoning: string;
  /** Proven Etsy search terms (real volume data) to prefer among the 13 seoTags. */
  marketKeywords?: string[];
}): string {
  const focus = process.env.FORGE_PRODUCT_FOCUS?.trim();
  const productGuidance = focus
    ? `PRODUCT FOCUS: Prefer these product type(s) unless the concept clearly fits another: ${focus}.`
    : `PRODUCT MIX: Pick the catalogKey that genuinely best fits the concept and vary product types across cycles — do NOT default to posters. Favor apparel (tees, sweatshirts) and mugs for slogan/identity/quote concepts; reserve posters for art-forward wall-decor concepts.`;

  return `Generate a POD listing + Printify blueprint for cycle ${input.runId.slice(0, 8)}.

Product idea:
- Concept: ${input.productConcept}
- Niche: ${input.niche}
- Target buyer: ${input.targetBuyer}
- Problem solved: ${input.problemSolved}
- Format: ${input.format}
- Category: ${input.category}
- Nova suggested price: $${input.suggestedPrice.toFixed(2)}
- Seed keywords: ${input.keywords.join(", ")}
- Nova reasoning: ${input.reasoning}
${
  input.marketKeywords?.length
    ? `- PROVEN Etsy search terms (verified real volume — include each one that fits this product among the 13 seoTags, and consider them for the title): ${input.marketKeywords.join(", ")}`
    : ""
}
${productGuidance}

Deliver a cohesive print-on-demand gift product with original IP-safe artwork, the best-fitting catalogKey, and an Etsy-ready listing draft.`;
}
