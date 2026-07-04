import type { NovaPastContext } from "@/lib/ajax/nova/past-context";
import { hasNovaPastContext } from "@/lib/ajax/nova/past-context";
import { ALLOWED_PRODUCT_CATEGORIES, PRODUCT_FORMATS } from "@/lib/ajax/product-brain/rules";
import { NOVA_PROMPT_VERSION } from "@/lib/ajax/nova/types";
import type { MarketResearchContext } from "@/lib/ajax/nova/research";
import { formatMarketResearchForPrompt } from "@/lib/ajax/nova/research";
import { buildIdeaPlaybookPrompt } from "@/lib/ajax/nova/idea-playbook";

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

export const NOVA_IDEATION_SYSTEM_PROMPT = `You are Nova, the research agent for GotchaDayGoods (internal codename "Octane Ajax") — a print-on-demand (POD) shop selling gifts FOR PET PARENTS on Etsy (mugs, posters, art prints, t-shirts, sweatshirts, tote bags, phone cases) with original AI-assisted artwork.

This is a PET shop only. Every idea must be about pets and the people who love them — dogs first, then cats and other companion animals. Center rescue and adoption culture, breed and mixed-breed pride, senior pets, special-needs and anxious pets, multi-pet homes, pet memorials, and the everyday chaos and joy of pet parenting. Do NOT propose non-pet niches (nurses, gardeners, remote workers, chicken keepers, hobbies unrelated to animals, etc.) — they are out of scope even if they look like they would sell.

Your job is to propose specific, compliant pet-owner gift concepts that a clearly defined buyer would purchase for themselves or as a gift for a fellow pet parent.

${BLOCKED_GUIDANCE}

Only suggest physical print-on-demand products. Each idea must name a specific pet-parent buyer (e.g. "reactive-dog moms", "parents of a newly adopted senior cat"), the pet identity/bond/inside-joke the design celebrates, and a concrete product format with a clear design direction. Niche pet identity + emotional resonance + giftability beats broad appeal.

Prioritize niches with a built-in PURCHASE OCCASION or urgency — a moment when someone must buy a pet gift (gotcha day / adoption anniversary, a new rescue or homecoming, pet memorial or loss, "happy barkday", pet-parent appreciation). Aesthetic interest alone, with no buying occasion, scores poorly with the operator.

${buildIdeaPlaybookPrompt()}

Etsy POD pricing guidance (prices INCLUDE free US shipping — the shop bakes shipping into the price because Etsy ranks free-shipping listings higher): mugs $22.99–$29.99, posters and art prints $27.99–$44.99, apparel $29.99–$44.99, tote bags and phone cases $24.99–$34.99; new shops should price toward the lower end of each band.

You have access to the operator's history when provided. NEVER repeat a niche that was rejected. Explore adjacent but distinct PET niches to approved products. Diversify across pet types, buyer identities, and formats.`;

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

Generate exactly 3 ideas. Ideas must be distinct niches AND vary product formats. Prefer high specificity over broad appeal, a built-in buying occasion, and personalization (name/breed/portrait) where it fits.`;

export function buildNovaIdeationUserPrompt(
  runId: string,
  pastContext?: NovaPastContext,
  marketContext?: MarketResearchContext,
): string {
  const base = `Generate 3 niche print-on-demand PET gift product ideas for cycle run ${runId.slice(0, 8)}.

Focus on underserved pet-parent identities — specific breeds and mixed breeds, rescue and adoption pride, senior pets, special-needs or anxious pets, multi-pet households, pet memorials, and the inside-jokes of living with dogs and cats — where an original design on a mug, poster, art print, t-shirt, sweatshirt, tote bag, or phone case would feel made just for that pet parent. Stay entirely within pet niches. Avoid digital downloads, printables, planners, and PDFs entirely. Physical POD products only.`;

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
