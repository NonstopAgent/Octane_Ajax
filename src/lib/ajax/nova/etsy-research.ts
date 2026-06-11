/**
 * Etsy Market Research — Nova's competitor intelligence layer.
 *
 * Uses the Etsy Open API v3 public listings endpoint (no OAuth required,
 * only the app's API key) to surface what's actually selling. Nova feeds
 * this data into the LLM prompt so ideas are grounded in real demand signals
 * rather than pure speculation.
 */

export type EtsyListingSignal = {
  title: string;
  tags: string[];
  price: number;
  views: number;
  favorites: number;
};

export type EtsyMarketSnapshot = {
  query: string;
  topListings: EtsyListingSignal[];
  /** Most frequent tags across the top results. */
  topTags: string[];
  priceRange: { min: number; max: number; median: number };
  totalResults: number;
};

export type EtsyMarketContext = {
  snapshots: EtsyMarketSnapshot[];
  fetchedAt: string;
};

const ETSY_API_BASE = "https://openapi.etsy.com/v3/application";

/** Search queries Nova uses to ground ideation in real Etsy demand. */
export const NOVA_RESEARCH_QUERIES = [
  "funny niche coffee mug gift",
  "hobby t-shirt gift",
  "niche wall art print",
] as const;

function extractPrice(listing: Record<string, unknown>): number {
  const price = listing.price as Record<string, unknown> | null | undefined;
  if (!price) return 0;
  const amount = Number(price.amount ?? 0);
  const divisor = Number(price.divisor ?? 100);
  return divisor > 0 ? amount / divisor : 0;
}

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]!
    : ((sorted[mid - 1]! + sorted[mid]!) / 2);
}

function topFrequent(items: string[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = item.toLowerCase().trim();
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag]) => tag);
}

async function searchEtsyListings(
  query: string,
  apiKey: string,
  limit = 25,
): Promise<EtsyMarketSnapshot> {
  const url = new URL(`${ETSY_API_BASE}/listings/active`);
  url.searchParams.set("keywords", query);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("sort_on", "score");
  url.searchParams.set("type", "physical"); // physical POD products only

  const res = await fetch(url.toString(), {
    headers: {
      "x-api-key": apiKey,
      Accept: "application/json",
    },
    // Prevent hanging if Etsy is slow — Nova can still run on timeout
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    throw new Error(`Etsy API responded ${res.status} for query "${query}"`);
  }

  const json = (await res.json()) as {
    count?: number;
    results?: Record<string, unknown>[];
  };

  const listings = json.results ?? [];
  const totalResults = json.count ?? listings.length;

  const signals: EtsyListingSignal[] = listings.map((l) => ({
    title: String(l.title ?? "").trim(),
    tags: Array.isArray(l.tags)
      ? (l.tags as unknown[]).map((t) => String(t).trim()).filter(Boolean)
      : [],
    price: extractPrice(l),
    views: Number(l.views ?? 0),
    favorites: Number(l.num_favorers ?? 0),
  }));

  const prices = signals.map((s) => s.price).filter((p) => p > 0);
  const allTags = signals.flatMap((s) => s.tags);

  return {
    query,
    topListings: signals.slice(0, 10),
    topTags: topFrequent(allTags, 15),
    priceRange: {
      min: prices.length > 0 ? Math.min(...prices) : 0,
      max: prices.length > 0 ? Math.max(...prices) : 0,
      median: computeMedian(prices),
    },
    totalResults,
  };
}

/**
 * Run Etsy market research across Nova's standard queries.
 * Never throws — returns partial results on error so Nova can still run.
 */
export async function fetchEtsyMarketContext(
  apiKey: string,
): Promise<EtsyMarketContext | null> {
  if (!apiKey?.trim()) return null;

  const results = await Promise.allSettled(
    NOVA_RESEARCH_QUERIES.map((q) => searchEtsyListings(q, apiKey)),
  );

  const snapshots: EtsyMarketSnapshot[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      snapshots.push(result.value);
    } else {
      console.warn("[nova/etsy-research] query failed:", result.reason);
    }
  }

  if (snapshots.length === 0) return null;

  return { snapshots, fetchedAt: new Date().toISOString() };
}

/** Format market context as a compact string for the LLM prompt. */
export function formatEtsyContextForPrompt(ctx: EtsyMarketContext): string {
  const lines: string[] = [
    "LIVE ETSY MARKET DATA (use for differentiation, do NOT copy titles):",
    "",
  ];

  for (const snap of ctx.snapshots) {
    lines.push(`Query: "${snap.query}" — ${snap.totalResults} results`);

    if (snap.topListings.length > 0) {
      lines.push("Top listing titles (what already exists):");
      snap.topListings.slice(0, 6).forEach((l) => {
        lines.push(`  • ${l.title}`);
      });
    }

    if (snap.topTags.length > 0) {
      lines.push(`Trending tags: ${snap.topTags.slice(0, 8).join(", ")}`);
    }

    if (snap.priceRange.median > 0) {
      lines.push(
        `Price range: $${snap.priceRange.min.toFixed(2)}–$${snap.priceRange.max.toFixed(2)} (median $${snap.priceRange.median.toFixed(2)})`,
      );
    }

    lines.push("");
  }

  lines.push(
    "Generate ideas that FILL GAPS in this market — different niches, underserved buyers, or angles these listings miss.",
  );

  return lines.join("\n");
}
