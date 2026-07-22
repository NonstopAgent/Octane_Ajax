/**
 * Etsy Playbook — the proven, current best-practice knowledge the AI Reviewer
 * (and Nova/Forge) score against. Deliberately GENERIC to Etsy + selling
 * principles (not pet-specific) so it carries over to any store or market.
 *
 * Grounded in 2026 sources (see REVIEW.md / commit notes):
 * - Etsy 2026 algorithm: semantic/NLP — reads whole titles for intent, not
 *   keyword soup. First ~40 chars of the title are weighted heaviest.
 * - Title structure: [Primary keyword] | [Secondary keyword + modifier] |
 *   [Occasion / Recipient]. Natural, readable phrases.
 * - Tags: all 13 used, each a MULTI-WORD long-tail phrase (not single words).
 * - Attributes: fill color/material/occasion — they act as authoritative tags
 *   and gate filtered-search visibility.
 * - Ranking = keywords get you in; clicks, favorites, conversion, high-quality
 *   photos, free/competitive shipping, and reviews (Star Seller) decide rank.
 * - Sell-side: ~68% of bestsellers put PERSONALIZATION in the title; gift
 *   framing ("gift for her", "birthday gift", "personalized gift") wins; a
 *   built-in occasion/urgency converts; price is justified by uniqueness;
 *   season winners are listed 6–10 weeks before the holiday.
 */

export const ETSY_PLAYBOOK = {
  title: {
    maxChars: 140,
    heavyWeightChars: 40,
    /** Etsy's April 2026 guidance: streamline to under ~15 words. */
    maxWords: 14,
    structure:
      "[What the item IS + its top objective traits] | [The distinctive theme or feature]",
    // Etsy's April 2026 title table, verbatim policy: noun once; objective
    // descriptors (color/material/size) upfront; occasion words only when
    // essential to what the item IS; gifting/aspirational phrases OUT of the
    // title (tags carry them); subjective words out; sale/shipping words out.
    rules: [
      "State what the item IS (mug, sweatshirt, bandana) exactly ONCE — Etsy search reads the whole listing, the title doesn't have to do all the work.",
      "Front-load the strongest buyer search phrase and the top objective traits (color, material, size) in the first ~40 characters.",
      "Read as a natural phrase a human would type, not a pile of keywords.",
      "NO gifting or aspirational phrases in the title ('gift for her', 'personalized gift', 'perfect present') — Etsy's 2026 guidance moves these to tags and the description.",
      "Include a holiday/occasion/recipient word ONLY if it's essential to what the item is (a 'gotcha day bandana' qualifies; 'gift for dog moms' does not).",
      "No subjective words (beautiful, perfect), no price/sale/shipping words — Etsy badges those automatically.",
      "Stay at or under 140 characters AND 14 words — Etsy flags longer titles as stuffed.",
      "Never repeat the same significant word (e.g. 'dog' or 'rescue' twice) — say it once; tags carry the variations.",
    ],
  },
  tags: {
    count: 13,
    rules: [
      "Use all 13 tags — leaving any empty forfeits free reach.",
      "Every tag is a MULTI-WORD long-tail phrase (e.g. 'rescue dog mom mug'), never a single broad word.",
      "Mix broad, specific, and occasion/recipient phrases; no near-duplicates.",
      "Gifting and recipient phrases LIVE HERE (not in the title): 'gotcha day gift', 'dog mom gift', 'gift for cat lovers'.",
      "Match the language real buyers search, not internal jargon.",
    ],
  },
  attributes: [
    "Fill every relevant attribute (color, material, occasion, recipient) — they are authoritative tags and gate filtered search.",
  ],
  ranking: [
    "Etsy search is holistic: title, tags, attributes, description, FIRST PHOTO, and reviews all feed matching — keywords earn impressions; clicks, favorites and conversion earn rank.",
    "The title and first photo must obviously describe the SAME item — mismatched ad clicks bounce and depress rank.",
    "High-quality, value-communicating photos (use every photo slot) and a clean, uncluttered thumbnail lift click-through; no watermarks or promo text on images.",
    "Free/competitive shipping (baked into price) is a ranking and conversion boost; visible estimated delivery dates close the sale.",
    "Reviews + Star Seller behavior (on-time, responsive, 5-star) compound ranking over time.",
  ],
  sellSide: [
    "Personalization sells — most bestsellers signal it in the title as part of what the item IS ('Personalized Dog Name Mug'). Prefer concepts that feel made-for-one-person.",
    "The DESCRIPTION carries the gift framing: name the recipient and the moment there and in tags ('gift for her', 'gotcha day gift') — never stuffed into the title.",
    "Include a clear HOW-TO-PERSONALIZE block in the description ('In the personalization box, tell us: your pet's name' + date if relevant) — friction here kills conversion on personalized items.",
    "A built-in purchase occasion/urgency (gotcha day, memorial, milestone) converts far better than aesthetics alone.",
    "Buyer-identity specificity wins clicks: a breed- or role-specific design ('Australian Shepherd Mom') out-pulls the same design addressed to everyone (proven in this shop's own ad data, July 2026).",
    "Justify price with uniqueness — a specific, can't-find-it-elsewhere design outsells a generic cheaper one; price competitively but never cheapest-at-all-costs.",
    "Seasonal/holiday products should be listed 6–10 weeks ahead to rank before demand peaks.",
  ],
  professionalism: [
    "Title is clean, correctly capitalized, no keyword-stuffing or ALL CAPS spam.",
    "Description opens with the hook + who it's for in the first ~160 characters (that's the search/Google snippet), then benefits, personalization instructions, then care/shipping.",
    "Design bar is BOUTIQUE, not clipart: one focal element, a cohesive 2-3 color palette, generous breathing room, nothing important near print edges. Dense text blocks and busy patterns read as low-quality (operator-verified, July 2026).",
    "Personalized designs ship as the BASE design with a clean space reserved for the buyer's name/date — sample names or dates are never baked into the artwork.",
    "Judge the provided design/mockup on its own quality — clean, legible, well-composed, good contrast, safe margins, print-ready. Front/angle/lifestyle mockups are auto-generated at publish, so do NOT penalize mockup count here; grade the design itself.",
    "No medical/legal/financial claims, no copyrighted IP, no guaranteed-results language.",
  ],
} as const;

/** Dimensions the reviewer scores (0–100 each) and their weights. */
export const REVIEW_DIMENSIONS = [
  { key: "seo", label: "Etsy SEO", weight: 0.3 },
  { key: "sellability", label: "Sellability", weight: 0.25 },
  { key: "brand", label: "Brand fit", weight: 0.15 },
  { key: "quality", label: "Listing quality / professionalism", weight: 0.15 },
  { key: "compliance", label: "Compliance", weight: 0.15 },
] as const;

export type ReviewDimensionKey = (typeof REVIEW_DIMENSIONS)[number]["key"];

/**
 * Auto-approve at/above this weighted score; below AUTO_REJECT send back for revision.
 * autoApprove is intentionally HIGH (85) — the operator only wants standout, 85+/100
 * listings to auto-publish and fill the store. Anything 60–84 is sent back to Forge to
 * improve (not published); below 60 is rejected outright. Override per-env if needed.
 */
export const REVIEW_THRESHOLDS = {
  autoApprove: Number(process.env.AI_REVIEWER_APPROVE_THRESHOLD ?? 85),
  autoReject: Number(process.env.AI_REVIEWER_REJECT_THRESHOLD ?? 60),
} as const;
