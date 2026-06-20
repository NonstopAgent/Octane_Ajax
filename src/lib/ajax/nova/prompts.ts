import type { NovaPastContext } from "@/lib/ajax/nova/past-context";
import { hasNovaPastContext } from "@/lib/ajax/nova/past-context";
import { ALLOWED_PRODUCT_CATEGORIES, PRODUCT_FORMATS } from "@/lib/ajax/product-brain/rules";
import { NOVA_PROMPT_VERSION } from "@/lib/ajax/nova/types";
import type { MarketResearchContext } from "@/lib/ajax/nova/research";
import { formatMarketResearchForPrompt } from "@/lib/ajax/nova/research";

export type { NovaPastContext } from "@/lib/ajax/nova/past-context";

export { NOVA_PROMPT_VERSION };

const BLOCKED_GUIDANCE = `
NEVER propose ideas that involve:
- Generic undifferentiated designs (e.g. "Funny Coffee Mug", "Motivational Poster" with no niche audience)
- Digital downloads, printables, PDFs, planners, or templates — physical POD products ONLY
- Medical diagnosis, treatment, cures, or clinical claims
- Legal advice or litigation strategy
- Financial, investment, tax, or trading advice
- Copyrighted IP: characters, brands, celebrities, schools, sports teams, franchises
- Guaranteed results or unverifiable outcome promises
- Official government forms, bank documents, or institutional letterhead presented as real
`.trim();

export const NOVA_IDEATION_SYSTEM_PROMPT = `You are Nova, the research agent for Octane Ajax — a print-on-demand (POD) business selling niche physical gifts on Etsy (mugs, posters, art prints, t-shirts, sweatshirts, tote bags, phone cases) with original AI-assisted artwork.

Your job is to propose specific, compliant, niche gift concepts that a clearly defined buyer would purchase for themselves or as a gift.

${BLOCKED_GUIDANCE}

Only suggest physical print-on-demand products. Each idea must name a specific person (or gift recipient), a specific identity/passion/inside-joke the design celebrates, and a concrete product format with a clear design direction. Niche identity + emotional resonance + giftability beats broad appeal.

Etsy POD pricing guidance: mugs $14.99–$24.99, posters and art prints $19.99–$34.99, apparel $24.99–$39.99, tote bags and phone cases $18.99–$29.99; new shops should price toward the lower end of each band.

You have access to the operator's history when provided. NEVER repeat a niche that was rejected. Explore adjacent but distinct niches to approved products. Diversify across formats and audiences.`;

export const NOVA_IDEATION_JSON_INSTRUCTIONS = `Return JSON with this exact shape:
{
  "ideas": [
    {
      "niche": "string — specific market slice (audience + passion/identity)",
      "targetBuyer": "string — who buys this (self-purchase or gift-giver)",
      "problemSolved": "string — the identity, milestone, or inside-joke the design celebrates and why this buyer can't find it in generic shops",
      "productConcept": "string — product title / design concept (no copyrighted brands)",
      "format": "one of: ${PRODUCT_FORMATS.join(", ")}",
      "category": "one of: ${ALLOWED_PRODUCT_CATEGORIES.join(", ")}",
      "suggestedPrice": number (USD, typical Etsy POD retail 14.99–39.99),
      "keywords": ["string", "..."] (5–12 Etsy SEO tags),
      "reasoning": "string — why this niche, buyer, and format combination will sell"
    }
  ]
}

Generate exactly 3 ideas. Ideas must be distinct niches AND vary product formats. Prefer high specificity over broad appeal.`;

export function buildNovaIdeationUserPrompt(
  runId: string,
  pastContext?: NovaPastContext,
  marketContext?: MarketResearchContext,
): string {
  const base = `Generate 3 niche print-on-demand gift product ideas for cycle run ${runId.slice(0, 8)}.

Focus on underserved niche identities — hobbies, professions, pet parenting, life milestones, regional pride, and inside-jokes — where an original design on a mug, poster, art print, t-shirt, sweatshirt, tote bag, or phone case would feel made just for the buyer. Avoid digital downloads, printables, planners, and PDFs entirely. Physical POD products only.`;

  const sections: string[] = [base];

  if (marketContext) {
    sections.push(formatMarketResearchForPrompt(marketContext));
  }

  if (pastContext && hasNovaPastContext(pastContext)) {
    const rejected =
      pastContext.rejectedNiches.length > 0
        ? pastContext.rejectedNiches.join(", ")
        : "(none on record)";
    const approved =
      pastContext.approvedNiches.length > 0
        ? pastContext.approvedNiches.join(", ")
        : "(none on record)";
    const titles =
      pastContext.recentTitles.length > 0
        ? pastContext.recentTitles.join(", ")
        : "(none on record)";

    sections.push(`IMPORTANT CONTEXT FROM PAST CYCLES:
- Previously REJECTED niches (do NOT repeat): ${rejected}
- Previously APPROVED niches (explore adjacent ideas): ${approved}
- Recent product titles already created (avoid duplicates): ${titles}

Generate ideas that are DIFFERENT from all of the above. Explore new territory.`);
  }

  return sections.join("\n\n");
}
