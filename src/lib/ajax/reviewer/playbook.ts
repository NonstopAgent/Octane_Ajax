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
    structure:
      "[Primary keyword] | [Secondary keyword + modifier] | [Occasion or Recipient]",
    rules: [
      "Front-load the strongest buyer search phrase in the first ~40 characters.",
      "Read as a natural phrase a human would type, not a pile of keywords.",
      "Name the recipient/occasion so it reads as a giftable item.",
      "Stay at or under 140 characters; avoid repetition and filler.",
    ],
  },
  tags: {
    count: 13,
    rules: [
      "Use all 13 tags — leaving any empty forfeits free reach.",
      "Every tag is a MULTI-WORD long-tail phrase (e.g. 'rescue dog mom mug'), never a single broad word.",
      "Mix broad, specific, and occasion/recipient phrases; no near-duplicates.",
      "Match the language real buyers search, not internal jargon.",
    ],
  },
  attributes: [
    "Fill every relevant attribute (color, material, occasion, recipient) — they are authoritative tags and gate filtered search.",
  ],
  ranking: [
    "Keywords earn impressions; clicks, favorites and conversion earn rank.",
    "High-quality, value-communicating photos and a clean thumbnail lift click-through.",
    "Free/competitive shipping (baked into price) is a ranking and conversion boost.",
    "Reviews + Star Seller behavior (on-time, responsive, 5-star) compound ranking over time.",
  ],
  sellSide: [
    "Personalization sells — most bestsellers signal it in the title. Prefer concepts that feel made-for-one-person.",
    "Frame as a gift: name the recipient and the moment ('gift for her', 'birthday gift', 'personalized gift').",
    "A built-in purchase occasion/urgency (gotcha day, memorial, milestone) converts far better than aesthetics alone.",
    "Justify price with uniqueness — a specific, can't-find-it-elsewhere design outsells a generic cheaper one.",
    "Seasonal/holiday products should be listed 6–10 weeks ahead to rank before demand peaks.",
  ],
  professionalism: [
    "Title is clean, correctly capitalized, no keyword-stuffing or ALL CAPS spam.",
    "Description opens with the hook + who it's for, then details, then care/shipping.",
    "At least a few varied, real (https) mockups — front, angle, and a lifestyle/context shot.",
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

/** Auto-approve at/above this weighted score; below AUTO_REJECT send back for revision. */
export const REVIEW_THRESHOLDS = {
  autoApprove: 78,
  autoReject: 55,
} as const;
