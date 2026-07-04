/**
 * Idea Playbook — the proven, data-backed patterns Nova ideates toward, so it
 * proposes products the market scorer and the Review Gate will REWARD (not ideas
 * that get downranked or rejected downstream). Same research lineage as the Etsy
 * reviewer playbook (see lib/ajax/reviewer/playbook.ts). Generic to giftable POD
 * so it carries across shops; the pet scope stays in Nova's prompt.
 *
 * Grounded in 2026 Etsy top-seller research:
 * - ~68% of bestsellers signal PERSONALIZATION in the title — it lifts price and
 *   conversion. A "made for one person" concept beats a generic mass-appeal one.
 * - A built-in PURCHASE OCCASION (a moment someone MUST buy) converts far better
 *   than aesthetics alone.
 * - Opportunity = demand ÷ supply: win the findable-but-not-saturated long tail,
 *   not broad head terms ("dog mom mug") that are red oceans for a new shop.
 * - Seasonal winners are listed 6–10 weeks BEFORE the demand peak to rank in time.
 */

export const IDEA_PLAYBOOK = {
  winners: [
    "Concrete buyer + identity + occasion beats a clever design with no one to buy it.",
    "A specific, can't-find-it-elsewhere concept justifies a higher price than a generic cheaper one.",
    "One clear focal idea per product — not a mash-up of three themes.",
  ],
  personalization: [
    "Prefer concepts that invite personalization (add a pet's name, breed, or a custom portrait) — most bestsellers signal it in the title.",
    "Personalized/made-to-one concepts command higher prices and convert better than generic ones.",
  ],
  occasion: [
    "Anchor every idea to a built-in buying moment: gotcha day / adoption anniversary, a new rescue or homecoming, a pet memorial or loss, a 'barkday', or pet-parent appreciation.",
    "Name the occasion in the concept — it's the reason someone buys today rather than 'someday'.",
  ],
  opportunity: [
    "Target the long-tail sweet spot: a specific breed/identity + occasion (findable but not saturated), not broad head terms crowded by thousands of listings.",
    "When real demand data is available, prefer niches with more monthly searches than competing listings.",
  ],
  seasonal: [
    "Propose seasonal/holiday concepts 6–10 weeks before the peak so they rank before demand hits.",
    "Pull the next upcoming gifting occasion forward instead of designing for a moment that already passed.",
  ],
  formatFit: [
    "Match format to concept: slogan/identity → apparel or mug; art-forward or memorial → poster, art print, or ornament; everyday-carry humor → tote or phone case.",
    "Vary formats across cycles — do not default to one product type.",
  ],
  avoid: [
    "Generic, no-audience designs (a 'funny dog mug' anyone could make).",
    "Broad saturated head terms with no differentiation.",
    "Aesthetic-only concepts with no buyer and no occasion.",
  ],
} as const;

const bullets = (items: readonly string[]) =>
  items.map((s) => `- ${s}`).join("\n");

/** Compose the proven idea patterns into a prompt block for Nova. */
export function buildIdeaPlaybookPrompt(): string {
  return `## WHAT ACTUALLY SELLS (proven Etsy patterns — ideate toward these)
Winning ideas:
${bullets(IDEA_PLAYBOOK.winners)}
Personalization (highest-leverage lever):
${bullets(IDEA_PLAYBOOK.personalization)}
Built-in occasion:
${bullets(IDEA_PLAYBOOK.occasion)}
Opportunity (demand vs. saturation):
${bullets(IDEA_PLAYBOOK.opportunity)}
Seasonal timing:
${bullets(IDEA_PLAYBOOK.seasonal)}
Format fit:
${bullets(IDEA_PLAYBOOK.formatFit)}
Avoid (these get downranked or rejected downstream):
${bullets(IDEA_PLAYBOOK.avoid)}`;
}
