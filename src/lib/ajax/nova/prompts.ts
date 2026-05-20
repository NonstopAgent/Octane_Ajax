import type { NovaPastContext } from "@/lib/ajax/nova/past-context";
import { hasNovaPastContext } from "@/lib/ajax/nova/past-context";
import { ALLOWED_PRODUCT_CATEGORIES, PRODUCT_FORMATS } from "@/lib/ajax/product-brain/rules";
import { NOVA_PROMPT_VERSION } from "@/lib/ajax/nova/types";
import type { EtsyMarketContext } from "@/lib/ajax/nova/etsy-research";
import { formatEtsyContextForPrompt } from "@/lib/ajax/nova/etsy-research";

export type { NovaPastContext } from "@/lib/ajax/nova/past-context";

export { NOVA_PROMPT_VERSION };

const BLOCKED_GUIDANCE = `
NEVER propose ideas that involve:
- Generic undifferentiated planners (e.g. "Daily Planner", "Weekly Planner" with no niche audience)
- Medical diagnosis, treatment, cures, or clinical claims
- Legal advice or litigation strategy
- Financial, investment, tax, or trading advice
- Copyrighted IP: characters, brands, celebrities, schools, sports teams, franchises
- Guaranteed results or unverifiable outcome promises
- Official government forms, bank documents, or institutional letterhead presented as real
`.trim();

export const NOVA_IDEATION_SYSTEM_PROMPT = `You are Nova, the research agent for Octane Ajax — a utility-first digital download business (printable planners, trackers, worksheets, checklists, templates, logbooks, bundles).

Your job is to propose specific, compliant, niche product concepts that solve a real problem for a defined buyer.

${BLOCKED_GUIDANCE}

Only suggest utility-first digital downloads. Each idea must name a specific person, a specific problem, and a structured printable format with clear usefulness.

Etsy printable pricing guidance: single trackers $4.99–$7.99, planners $7.99–$12.99, kits $12.99–$16.99; new shops should price toward the lower end of each band.

You have access to the operator's history when provided. NEVER repeat a niche that was rejected. Explore adjacent but distinct niches to approved products. Diversify.`;

export const NOVA_IDEATION_JSON_INSTRUCTIONS = `Return JSON with this exact shape:
{
  "ideas": [
    {
      "niche": "string — specific market slice",
      "targetBuyer": "string — who buys this",
      "problemSolved": "string — concrete problem the printable solves",
      "productConcept": "string — product title / concept (not copyrighted brands)",
      "format": "one of: ${PRODUCT_FORMATS.join(", ")}",
      "category": "one of: ${ALLOWED_PRODUCT_CATEGORIES.join(", ")}",
      "suggestedPrice": number (USD, typical Etsy digital download 3.99–14.99),
      "keywords": ["string", "..."] (5–12 Etsy SEO tags),
      "reasoning": "string — why this idea fits the niche and buyer"
    }
  ]
}

Generate exactly 3 ideas. Ideas must be distinct niches. Prefer high specificity over broad appeal.`;

export function buildNovaIdeationUserPrompt(
  runId: string,
  pastContext?: NovaPastContext,
  marketContext?: EtsyMarketContext,
): string {
  const base = `Generate 3 utility-first digital product ideas for cycle run ${runId.slice(0, 8)}.

Focus on underserved niches where a printable planner, tracker, worksheet, checklist, template, or logbook would save time or reduce stress. Avoid physical merch, mugs, posters, or apparel. Only digital downloads.`;

  const sections: string[] = [base];

  if (marketContext) {
    sections.push(formatEtsyContextForPrompt(marketContext));
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

    sections.push(`OPERATOR HISTORY FROM PAST CYCLES:
- Previously REJECTED niches (do NOT repeat): ${rejected}
- Previously APPROVED niches (explore adjacent ideas): ${approved}
- Recent product titles already created (avoid duplicates): ${titles}

Generate ideas that are DIFFERENT from all of the above. Explore new territory.`);
  }

  return sections.join("\n\n");
}
