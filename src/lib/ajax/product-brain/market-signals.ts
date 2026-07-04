/**
 * Market Signals — the DATA-BACKED half of the Product Brain.
 *
 * The base Product Brain scores an idea's *wording* (specificity, urgency,
 * buyer clarity). This module scores its *market*: does real demand exist, is
 * the niche saturated, does the price leave margin, and does the concept match
 * the patterns proven to sell on Etsy. It answers "should we even make this?"
 * with numbers, not vibes.
 *
 * Grounded in the same 2026 research as the reviewer playbook (see
 * lib/ajax/reviewer/playbook.ts and REVIEW.md):
 *  - Demand: long-tail Etsy terms convert best in a "findable but not saturated"
 *    band — a few hundred to a few thousand searches/mo. Sub-100 is too thin to
 *    move volume; 10k+ head terms are usually red oceans for a new shop.
 *  - Competition: opportunity ≈ demand ÷ supply. More monthly searches than
 *    total competing listings is a strong signal; >100k listings is a red ocean.
 *  - Margin: POD winners keep >50% gross margin; proven retail band is ~$18–45.
 *  - Proven patterns: ~68% of bestsellers put PERSONALIZATION in the title; gift
 *    framing and a built-in purchase OCCASION (gotcha day, memorial, milestone)
 *    convert far better than aesthetics alone.
 */
import {
  hasLongTailNicheLanguage,
  hasUrgencySignals,
  hasVagueBuyerLanguage,
  isGenericProductTitle,
} from "@/lib/ajax/product-brain/rules";

export type MarketRecommendation = "list" | "watch" | "skip";

/** A lightweight idea shape the market scorer needs (built from a Nova idea). */
export type MarketIdeaInput = {
  title: string;
  niche: string;
  targetBuyer: string;
  problemSolved?: string;
  keywords: string[];
  format?: string | null;
  priceUsd?: number | null;
};

/** A real market keyword row (from the MARKET_KEYWORDS table via Nova research). */
export type MarketKeywordRow = {
  term: string;
  searchesPerMonth: number | null;
  competingListings: number | null;
};

/** Real demand/supply signals matched to an idea (all nullable — degrade gracefully). */
export type MarketSignals = {
  searchesPerMonth: number | null;
  competingListings: number | null;
  matchedTerm: string | null;
};

export type MarketOpportunity = {
  /** 0–100 overall market opportunity (weighted over the dimensions we have). */
  marketScore: number;
  demandScore: number | null;
  competitionScore: number | null;
  marginScore: number | null;
  patternFitScore: number;
  recommendation: MarketRecommendation;
  reasons: string[];
  matchedTerm: string | null;
  /** True when REAL demand data was found — only then does market drive ranking. */
  hasData: boolean;
};

const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

/** Proven approximate POD base cost by format (USD) — used to estimate margin. */
const POD_BASE_COST: Record<string, number> = {
  tshirt: 10,
  sweatshirt: 22,
  mug: 8,
  poster: 7,
  art_print: 6,
  tote_bag: 11,
  phone_case: 12,
  sticker: 3,
};
const DEFAULT_POD_COST = 10;

export function estimatePodCost(format?: string | null): number {
  if (!format) return DEFAULT_POD_COST;
  return POD_BASE_COST[format] ?? DEFAULT_POD_COST;
}

const STOPWORDS = new Set([
  "the", "a", "an", "for", "and", "or", "to", "of", "with", "gift", "gifts",
  "custom", "personalized", "personalised",
]);

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/**
 * Match an idea to the best real keyword row by meaningful token overlap.
 * Returns the matched row's demand/supply, or nulls when nothing matches.
 */
export function matchMarketSignals(
  idea: MarketIdeaInput,
  keywords?: MarketKeywordRow[] | null,
): MarketSignals {
  const empty: MarketSignals = {
    searchesPerMonth: null,
    competingListings: null,
    matchedTerm: null,
  };
  if (!keywords || keywords.length === 0) return empty;

  const ideaTokens = new Set(
    [idea.niche, idea.title, ...idea.keywords].flatMap(tokenize),
  );
  if (ideaTokens.size === 0) return empty;

  let best: { row: MarketKeywordRow; overlap: number } | null = null;
  for (const row of keywords) {
    const rowTokens = tokenize(row.term);
    if (rowTokens.length === 0) continue;
    const overlap = rowTokens.filter((t) => ideaTokens.has(t)).length;
    if (overlap > 0 && (!best || overlap > best.overlap)) {
      best = { row, overlap };
    }
  }
  if (!best) return empty;
  return {
    searchesPerMonth: best.row.searchesPerMonth,
    competingListings: best.row.competingListings,
    matchedTerm: best.row.term,
  };
}

/** Demand from real monthly searches — peaks in the findable-but-not-saturated band. */
function scoreDemand(searchesPerMonth: number | null): number | null {
  if (searchesPerMonth == null || searchesPerMonth < 0) return null;
  const s = searchesPerMonth;
  if (s < 50) return 25;
  if (s < 300) return 65;
  if (s <= 2000) return 95; // sweet spot
  if (s <= 10000) return 75;
  return 50; // broad head term — usually saturated for a new shop
}

/** Opportunity from demand-to-supply ratio + absolute saturation guardrail. */
function scoreCompetition(
  searchesPerMonth: number | null,
  competingListings: number | null,
): number | null {
  if (competingListings == null || competingListings < 0) return null;
  if (competingListings > 100000) return 20; // red ocean
  if (searchesPerMonth == null) {
    // supply only: fewer listings is better
    if (competingListings < 1000) return 80;
    if (competingListings < 10000) return 60;
    if (competingListings < 50000) return 40;
    return 30;
  }
  const denom = Math.max(1, competingListings);
  const ratio = searchesPerMonth / denom;
  if (ratio >= 1) return 95;
  if (ratio >= 0.3) return 78;
  if (ratio >= 0.1) return 55;
  if (ratio >= 0.03) return 38;
  return 25;
}

/** Margin from retail price vs estimated POD cost (POD winners keep >50%). */
function scoreMargin(
  priceUsd: number | null | undefined,
  podCost: number,
): number | null {
  if (priceUsd == null || priceUsd <= 0) return null;
  const gross = (priceUsd - podCost) / priceUsd;
  let score: number;
  if (gross >= 0.6) score = 95;
  else if (gross >= 0.5) score = 80;
  else if (gross >= 0.4) score = 60;
  else if (gross >= 0.3) score = 40;
  else score = 20;
  // Mild penalty for prices outside the proven ~$12–60 band.
  if (priceUsd < 12 || priceUsd > 60) score -= 12;
  return clamp(score);
}

const PERSONALIZATION = /\b(personaliz|personalis|custom|name|monogram|your (dog|cat|pet)|portrait)\b/i;
const GIFT = /\b(gift|present|for (her|him|mom|dad|owner|lover))\b/i;

/** Fit to proven top-seller patterns: personalization, gift framing, occasion, specificity. */
function scorePatternFit(idea: MarketIdeaInput): { score: number; hits: string[] } {
  const text = [idea.title, idea.niche, idea.problemSolved ?? "", idea.keywords.join(" ")]
    .join(" ")
    .toLowerCase();
  const hits: string[] = [];
  let score = 40;

  if (PERSONALIZATION.test(text)) {
    score += 20;
    hits.push("personalization");
  }
  if (GIFT.test(text)) {
    score += 15;
    hits.push("gift framing");
  }
  if (hasUrgencySignals(text)) {
    score += 15;
    hits.push("built-in occasion");
  }
  if (hasLongTailNicheLanguage(text)) score += 10;
  if (isGenericProductTitle(idea.title)) score -= 15;
  if (hasVagueBuyerLanguage(idea.targetBuyer)) score -= 10;

  return { score: clamp(score), hits };
}

/** Weighted blend over only the dimensions we actually have. */
function blend(
  parts: Array<{ score: number | null; weight: number }>,
): number {
  const present = parts.filter((p) => p.score != null) as Array<{
    score: number;
    weight: number;
  }>;
  const totalWeight = present.reduce((s, p) => s + p.weight, 0);
  if (totalWeight === 0) return 0;
  return clamp(
    present.reduce((s, p) => s + p.score * p.weight, 0) / totalWeight,
  );
}

function fmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : `${n}`;
}

/**
 * Score an idea's MARKET opportunity from real signals + proven patterns.
 * When no real demand data is matched, `hasData` is false and the score reflects
 * only margin + pattern fit (advisory) — it must NOT be used to hard-skip.
 */
export function evaluateMarketOpportunity(
  idea: MarketIdeaInput,
  signals: MarketSignals,
): MarketOpportunity {
  const demandScore = scoreDemand(signals.searchesPerMonth);
  const competitionScore = scoreCompetition(
    signals.searchesPerMonth,
    signals.competingListings,
  );
  const podCost = estimatePodCost(idea.format);
  const marginScore = scoreMargin(idea.priceUsd, podCost);
  const pattern = scorePatternFit(idea);
  const hasData = demandScore != null || competitionScore != null;

  let marketScore = blend([
    { score: demandScore, weight: 0.35 },
    { score: competitionScore, weight: 0.3 },
    { score: marginScore, weight: 0.15 },
    { score: pattern.score, weight: hasData ? 0.2 : 0.6 },
  ]);

  // Saturation is a soft gate: no matter how strong demand/margin/pattern look,
  // a crowded niche caps the real opportunity (you can't win a red ocean).
  if (competitionScore != null) {
    marketScore = Math.min(marketScore, clamp(40 + competitionScore * 0.6));
  }

  const reasons: string[] = [];
  if (signals.searchesPerMonth != null) {
    const supply =
      signals.competingListings != null
        ? ` vs ~${fmt(signals.competingListings)} competing listings`
        : "";
    reasons.push(
      `Real demand ~${fmt(signals.searchesPerMonth)} searches/mo${supply}${
        signals.matchedTerm ? ` ("${signals.matchedTerm}")` : ""
      }.`,
    );
  } else {
    reasons.push("No matched search-volume data — demand unproven, treat as a bet.");
  }
  if (marginScore != null && idea.priceUsd != null) {
    const gross = Math.round(((idea.priceUsd - podCost) / idea.priceUsd) * 100);
    reasons.push(
      `Retail $${idea.priceUsd.toFixed(2)} vs ~$${podCost} POD cost → ${gross}% margin.`,
    );
  }
  if (pattern.hits.length > 0) {
    reasons.push(`Matches proven bestseller patterns: ${pattern.hits.join(", ")}.`);
  } else {
    reasons.push("Weak on proven patterns (no personalization / gift / occasion signal).");
  }

  let recommendation: MarketRecommendation;
  if (hasData) {
    const compOk = competitionScore == null || competitionScore >= 45;
    const demandOk = demandScore == null || demandScore >= 55;
    if (marketScore >= 70 && demandOk && compOk) recommendation = "list";
    else if (
      marketScore < 45 ||
      (competitionScore != null && competitionScore < 30) ||
      (demandScore != null && demandScore < 30)
    )
      recommendation = "skip";
    else recommendation = "watch";
  } else {
    // No proven demand — never hard-skip on text alone; the base Brain gates that.
    recommendation = "watch";
  }

  return {
    marketScore,
    demandScore,
    competitionScore,
    marginScore,
    patternFitScore: pattern.score,
    recommendation,
    reasons,
    matchedTerm: signals.matchedTerm,
    hasData,
  };
}
