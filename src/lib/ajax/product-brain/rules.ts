import type { ProductBrainInput, ProductCategory } from "@/lib/ajax/product-brain/types";

export const ALLOWED_PRODUCT_CATEGORIES: readonly ProductCategory[] = [
  "education",
  "productivity",
  "small_business",
  "home_organization",
  "wellness_tracking",
  "parenting_support",
  "student_tools",
  "creator_tools",
  "pet_lovers",
  "occupation_gifts",
  "hobby_leisure",
  "humor_novelty",
  "seasonal_holiday",
] as const;

export const PRODUCT_FORMATS = [
  "mug",
  "poster",
  "art_print",
  "tshirt",
  "sweatshirt",
  "tote_bag",
  "phone_case",
] as const;

export interface BlockedContentRule {
  id: string;
  label: string;
  patterns: RegExp[];
}

export const BLOCKED_CONTENT_RULES: readonly BlockedContentRule[] = [
  {
    id: "medical_claims",
    label: "Medical diagnosis or treatment claims",
    patterns: [
      /\b(diagnos(e|is|ing)|treat(ment|ing)?|cure(s|d)?|prescri(be|ption)|clinical\s+trial|fda\s+approved)\b/i,
      /\b(medical\s+advice|healthcare\s+provider|symptom\s+relief|disease\s+management)\b/i,
    ],
  },
  {
    id: "legal_advice",
    label: "Legal advice",
    patterns: [
      /\b(legal\s+advice|attorney\s+client|lawsuit\s+strategy|court\s+representation)\b/i,
    ],
  },
  {
    id: "financial_advice",
    label: "Financial or investment advice",
    patterns: [
      /\b(investment\s+advice|stock\s+picks?|crypto\s+signals?|financial\s+planning\s+services?)\b/i,
      /\b(guaranteed\s+(returns?|profit|income|roi))\b/i,
    ],
  },
  {
    id: "trademarked_content",
    label: "Copyrighted characters, brands, celebrities, schools, sports teams, or franchises",
    patterns: [
      /\b(disney|marvel|pixar|mickey\s+mouse|harry\s+potter|pokemon|nintendo|star\s+wars)\b/i,
      /\b(nfl|nba|mlb|nhl|fifa|premier\s+league)\b/i,
      /\b(patriots|cowboys|yankees|lakers|warriors)\b/i,
      /\b(harvard|yale|stanford|mit)\b/i,
      /\b(taylor\s+swift|beyonc[eé]|elon\s+musk)\b/i,
    ],
  },
  {
    id: "guaranteed_results",
    label: "Guaranteed results",
    patterns: [
      /\b(guaranteed\s+results?|100\s*%\s+success|instant\s+results?|never\s+fail)\b/i,
    ],
  },
  {
    id: "government_impersonation",
    label: "Official form or government document impersonation",
    patterns: [
      /\b(official\s+(irs|government|dmv|passport|visa)\s+form)\b/i,
      /\b(government\s+issued|federal\s+document\s+template|official\s+tax\s+return)\b/i,
    ],
  },
] as const;

const GENERIC_PRODUCT_TITLES = [
  "daily planner",
  "weekly planner",
  "monthly planner",
  "habit tracker",
  "budget planner",
  "to do list",
  "calendar template",
  "printable planner",
  "funny mug",
  "coffee mug",
  "custom mug",
  "funny t-shirt",
  "custom t-shirt",
  "graphic tee",
  "motivational poster",
  "wall art",
  "cute sticker",
  "tote bag",
  "phone case",
];

const LONG_TAIL_SIGNAL_WORDS = [
  "for parents",
  "for teachers",
  "for students",
  "for small business",
  "for homeschool",
  "for adhd",
  "for autism",
  "for pda",
  "morning routine",
  "evening routine",
  "iep",
  "sensory",
  "executive function",
  "dog mom",
  "dog dad",
  "cat mom",
  "cat dad",
  "for nurses",
  "night shift",
  "plant lady",
  "chicken math",
  "hobby farm",
  "rescue dog",
  "for beekeepers",
  "for gardeners",
  "retirement gift",
  "new parents",
  "for crocheters",
  "for quilters",
];

const VAGUE_BUYER_PHRASES = [
  "everyone",
  "anyone",
  "people",
  "users",
  "customers",
  "general audience",
  "all ages",
];

const URGENCY_SIGNAL_WORDS = [
  "overwhelmed",
  "chaos",
  "stress",
  "deadline",
  "struggle",
  "urgent",
  "daily battle",
  "meltdown",
  "burnout",
  "last minute",
  "birthday",
  "anniversary",
  "graduation",
  "retirement",
  "holiday season",
  "mother's day",
  "father's day",
];

const CONCRETE_FORMAT_WORDS: Record<string, string[]> = {
  mug: ["mug", "coffee", "cup", "drinkware"],
  poster: ["poster", "wall art", "print", "decor"],
  art_print: ["art print", "print", "wall art", "illustration", "artwork"],
  tshirt: ["t-shirt", "tshirt", "tee", "shirt", "apparel"],
  sweatshirt: ["sweatshirt", "hoodie", "crewneck", "apparel"],
  tote_bag: ["tote", "bag", "carryall"],
  phone_case: ["phone case", "case", "phone cover"],
};

/** Concatenate searchable product copy for rule and scoring passes. */
export function collectProductText(input: ProductBrainInput): string {
  return [
    input.title,
    input.niche,
    input.targetBuyer,
    input.problemSolved,
    input.description,
    ...input.keywords,
  ]
    .join(" ")
    .toLowerCase();
}

export function isAllowedCategory(category: ProductCategory): boolean {
  return (ALLOWED_PRODUCT_CATEGORIES as readonly string[]).includes(category);
}

export function findBlockedContentViolations(text: string): string[] {
  const normalized = text.toLowerCase();
  const violations: string[] = [];

  for (const rule of BLOCKED_CONTENT_RULES) {
    const matched = rule.patterns.some((pattern) => pattern.test(normalized));
    if (matched) {
      violations.push(rule.label);
    }
  }

  return violations;
}

export function isGenericProductTitle(title: string): boolean {
  const normalized = title.trim().toLowerCase();
  return GENERIC_PRODUCT_TITLES.some(
    (generic) =>
      normalized === generic || normalized.startsWith(`${generic} `),
  );
}

export function hasLongTailNicheLanguage(text: string): boolean {
  const normalized = text.toLowerCase();
  return LONG_TAIL_SIGNAL_WORDS.some((phrase) => normalized.includes(phrase));
}

export function hasVagueBuyerLanguage(targetBuyer: string): boolean {
  const normalized = targetBuyer.trim().toLowerCase();
  if (!normalized || normalized.length < 8) return true;
  return VAGUE_BUYER_PHRASES.some((phrase) => normalized.includes(phrase));
}

export function countWords(value: string): number {
  return value
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0).length;
}

/** Connector words that may legitimately appear more than once in a title. */
const TITLE_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "for",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
  "your",
]);

/**
 * Significant words that appear MORE THAN ONCE in a title, with their counts —
 * the signal behind Etsy's "Try to avoid repetition: 'rescue', 'dog'" tip.
 * Returns [word, count] pairs (lowercased), empty when the title is clean.
 */
export function repeatedTitleWords(title: string): [string, number][] {
  const counts = new Map<string, number>();
  for (const raw of title.toLowerCase().split(/[^a-z0-9']+/)) {
    const word = raw.trim();
    if (word.length < 3 || TITLE_STOPWORDS.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n > 1);
}

/**
 * Etsy title-style problems (the rules Etsy's "Update titles" widget
 * enforces): over 14 words, or heavy keyword repetition. Etsy's own accepted
 * suggestions tolerate ONE word appearing twice, so only flag a word used 3+
 * times or two+ different words each doubled — that's the stuffed-title
 * pattern its search-visibility banner keeps re-flagging. Empty = clean.
 */
export function titleStyleIssues(title: string): string[] {
  const issues: string[] = [];
  const words = countWords(title.replace(/\|/g, " "));
  if (words > 14) {
    issues.push(
      `Title is ${words} words — Etsy flags titles over 14 words as stuffed. Tighten to ≤14 words.`,
    );
  }
  const repeats = repeatedTitleWords(title);
  const heavy = repeats.some(([, n]) => n >= 3) || repeats.length >= 2;
  if (heavy) {
    issues.push(
      `Title repeats ${repeats.map(([w, n]) => `"${w}" ×${n}`).join(", ")} — say each significant word once; tags carry variations.`,
    );
  }
  return issues;
}

export function hasUrgencySignals(text: string): boolean {
  const normalized = text.toLowerCase();
  return URGENCY_SIGNAL_WORDS.some((word) => normalized.includes(word));
}

export function formatAlignsWithCopy(
  format: ProductBrainInput["format"],
  text: string,
): boolean {
  const normalized = text.toLowerCase();
  const signals = CONCRETE_FORMAT_WORDS[format] ?? [];
  return signals.some((word) => normalized.includes(word));
}
