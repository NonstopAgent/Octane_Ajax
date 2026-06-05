import {
  AI_DISCLOSURE_TEXT,
  FORGE_PROMPT_VERSION,
  IP_SAFE_AESTHETIC_STYLES,
} from "@/lib/ajax/forge/types";

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

Turn an approved product idea into a complete Etsy listing draft and a Printify product blueprint. Favor niche specificity, giftability, and IP-safe original artwork directions.

Etsy POD pricing guidance: mugs $14.99–$24.99, posters $19.99–$34.99, apparel $24.99–$39.99; new shops should price toward the lower end.

Use ONLY these IP-safe aesthetic styles (no copyrighted character or brand styles): ${AESTHETIC_LIST}.

${BLOCKED_GUIDANCE}

Every listing must be honest about AI assistance. Include this exact sentence in listingDescription and aiDisclosure:
"${AI_DISCLOSURE_TEXT}"`;

export const FORGE_GENERATION_JSON_INSTRUCTIONS = `Return JSON with this exact shape:
{
  "listingTitle": "string — Etsy listing title (specific, no copyrighted brands)",
  "listingDescription": "string — buyer-facing description with bullet benefits; MUST include the AI disclosure sentence verbatim",
  "seoTags": ["string", ...] (exactly 13 Etsy tags, no duplicates, niche-specific),
  "suggestedPrice": number (USD retail price for physical POD product, typically 14.99–49.99),
  "podDetails": {
    "blueprintId": number (Printify blueprint ID — e.g. 68 for 11oz mug, 1 for poster),
    "printProviderId": number (Printify print provider ID),
    "variantIds": [number, ...] (1–20 enabled variant IDs for this blueprint),
    "artworkPrompt": "string — detailed original artwork prompt, 20+ chars, no brands/characters/logos",
    "aestheticStyle": "one of: ${AESTHETIC_LIST}"
  },
  "complianceNotes": ["string", ...] (policy reminders for human review, may be empty),
  "aiDisclosure": "string — MUST be exactly: ${AI_DISCLOSURE_TEXT}",
  "coverImagePrompt": "string — safe product mockup prompt (no brands/celebrities)",
  "revisionNotes": ["string", ...] (internal notes for seller review)
}

Rules:
- podDetails.artworkPrompt must describe original, IP-safe artwork suitable for print
- podDetails.aestheticStyle must be one of the allowed IP-safe styles
- podDetails.variantIds: at least one variant, max 20
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
}): string {
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

Deliver a cohesive print-on-demand gift product with original IP-safe artwork, Printify blueprint IDs, and an Etsy-ready listing draft.`;
}
