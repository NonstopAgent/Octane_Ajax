/**
 * Marketing Playbook — the proven conversion patterns Pixel writes against, so
 * its copy actually drives clicks and sales instead of reading like generic
 * captions. The copy counterpart to the short-form video-playbook. Same research
 * lineage as the reviewer/idea playbooks.
 *
 * Grounded in stable, widely-validated Etsy + social patterns:
 * - The first line is the whole game — a scroll-stopping hook (question, POV,
 *   or bold specific claim), never throat-clearing or the brand name.
 * - People buy the identity/occasion, not the product specs — lead with who it's
 *   for and the moment, then the benefit, then a light feature note.
 * - Pinterest is a search engine: keyword-rich, evergreen, benefit + occasion in
 *   the title and description. Instagram/TikTok reward hook + authenticity.
 * - Hashtags convert when they're a MIX (broad reach + niche community + buyer
 *   intent/occasion), not a spammy pile of the same broad tags.
 * - Every post names the occasion urgency and ends with a clear CTA + the
 *   trackable shop link (Etsy Share & Save) so clicks are attributable.
 */

export const MARKETING_PLAYBOOK = {
  hook: [
    "Open with a scroll-stopper in the first line: a POV, a question, or a bold specific claim — never the brand name or 'Check out our…'.",
    "Speak to ONE buyer and their moment ('rescue dog moms on their first gotcha day'), not 'everyone who loves pets'.",
  ],
  body: [
    "Sell the identity/occasion and the feeling first; mention product/quality briefly, not as a spec dump.",
    "Echo the product's personalization (name/breed/portrait) — it's the reason this beats a generic gift.",
    "Keep it tight and skimmable; one idea per line.",
  ],
  platforms: [
    "Pinterest = SEO: keyword-rich title + description, benefit + occasion, evergreen wording (it keeps working for months).",
    "Instagram/TikTok = hook + authenticity + a clear CTA; save raw links for 'link in bio'.",
    "Facebook = community + gift framing ('tag the dog mom who needs this').",
  ],
  hashtags: [
    "Use a MIX: a few broad-reach, several niche/community, a few buyer-intent/occasion tags.",
    "Match how real buyers search; avoid a spammy pile of identical broad tags.",
  ],
  cta: [
    "Name the occasion urgency ('before their gotcha day') to earn the click.",
    "End with a clear ask + the trackable shop link so clicks are attributable; use 'link in bio' where raw URLs don't belong.",
  ],
  compliance: [
    "No invented discounts, guarantees, or medical/outcome claims.",
    "Free US shipping may be cited (it's baked into price); never fabricate sales.",
  ],
} as const;

const bullets = (items: readonly string[]) =>
  items.map((s) => `- ${s}`).join("\n");

/** Compose the proven marketing patterns into a prompt block for Pixel. */
export function buildMarketingPlaybookPrompt(): string {
  return `## WHAT ACTUALLY CONVERTS (proven patterns — write toward these)
Hook (the first line is the whole game):
${bullets(MARKETING_PLAYBOOK.hook)}
Body:
${bullets(MARKETING_PLAYBOOK.body)}
Per platform:
${bullets(MARKETING_PLAYBOOK.platforms)}
Hashtags:
${bullets(MARKETING_PLAYBOOK.hashtags)}
Call to action:
${bullets(MARKETING_PLAYBOOK.cta)}`;
}
