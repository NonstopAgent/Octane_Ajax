/**
 * Nova Market Research — multi-source competitive intelligence.
 *
 * Aggregates real demand signals from several sources, each activated by its
 * own API key and failing gracefully (so Nova always runs):
 *   - Etsy Open API   (ETSY_CLIENT_ID)      — what's already selling on Etsy
 *   - Google Trends   (SERPAPI_API_KEY)     — rising search demand
 *   - YouTube Data API(YOUTUBE_API_KEY)     — content/buzz people make & watch
 *
 * The combined context is fed into Nova's ideation prompt so ideas are grounded
 * in what's actually working, not speculation.
 */
import {
  type EtsyMarketContext,
  fetchEtsyMarketContext,
  formatEtsyContextForPrompt,
} from "@/lib/ajax/nova/etsy-research";
import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";

export type TrendSignal = { seed: string; queries: string[] };
export type YouTubeSignal = { seed: string; videoTitles: string[] };

export type MarketResearchContext = {
  etsy: EtsyMarketContext | null;
  trends: TrendSignal[] | null;
  youtube: YouTubeSignal[] | null;
  sources: string[];
  fetchedAt: string;
};

export type ResearchSeedOptions = { supabase?: Supabase; userId?: string };

/** Broader, more creative fallback seeds (used when there's no accepted strategy yet). */
const FALLBACK_SEEDS = [
  "hobby-specific humor apparel",
  "occupation pride gift",
  "pet breed specific accessories",
  "fandom-adjacent aesthetic art",
  "life milestone celebration",
] as const;

/**
 * Resolves research seeds dynamically: prefer the operator's accepted War Room
 * niche recommendations, then supplement with a randomized fallback set so each
 * cycle explores something fresh (instead of the same saturated terms).
 */
async function resolveResearchSeeds(opts?: ResearchSeedOptions): Promise<string[]> {
  const seeds: string[] = [];

  if (opts?.supabase && opts.userId) {
    try {
      const { data } = await opts.supabase
        .from(TABLES.STRATEGY)
        .select("title")
        .eq("user_id", opts.userId)
        .eq("category", "niche")
        .in("status", ["accepted", "actioned"])
        .order("created_at", { ascending: false })
        .limit(3);
      for (const row of data ?? []) {
        const title = (row.title ?? "").trim();
        if (title) seeds.push(title);
      }
    } catch {
      // fall through to fallback seeds
    }
  }

  const shuffled = [...FALLBACK_SEEDS].sort(() => Math.random() - 0.5);
  for (const seed of shuffled) {
    if (seeds.length >= 3) break;
    if (!seeds.includes(seed)) seeds.push(seed);
  }
  return seeds.slice(0, 3);
}

async function fetchGoogleTrends(
  seeds: readonly string[],
): Promise<TrendSignal[] | null> {
  const key = process.env.SERPAPI_API_KEY?.trim();
  if (!key) return null;

  const out: TrendSignal[] = [];
  await Promise.allSettled(
    seeds.map(async (seed) => {
      const url = new URL("https://serpapi.com/search.json");
      url.searchParams.set("engine", "google_trends");
      url.searchParams.set("data_type", "RELATED_QUERIES");
      url.searchParams.set("q", seed);
      url.searchParams.set("api_key", key);

      const res = await fetch(url.toString(), {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`SerpApi responded ${res.status}`);
      const json = (await res.json()) as {
        related_queries?: {
          rising?: { query?: string }[];
          top?: { query?: string }[];
        };
      };
      const rising = (json.related_queries?.rising ?? [])
        .map((r) => r.query ?? "")
        .filter(Boolean)
        .slice(0, 6);
      const top = (json.related_queries?.top ?? [])
        .map((r) => r.query ?? "")
        .filter(Boolean)
        .slice(0, 4);
      const queries = [...rising, ...top];
      if (queries.length > 0) out.push({ seed, queries });
    }),
  );

  return out.length > 0 ? out : null;
}

async function fetchYouTubeBuzz(
  seeds: readonly string[],
): Promise<YouTubeSignal[] | null> {
  const key = process.env.YOUTUBE_API_KEY?.trim();
  if (!key) return null;

  const out: YouTubeSignal[] = [];
  await Promise.allSettled(
    seeds.map(async (seed) => {
      const url = new URL("https://www.googleapis.com/youtube/v3/search");
      url.searchParams.set("part", "snippet");
      url.searchParams.set("type", "video");
      url.searchParams.set("order", "viewCount");
      url.searchParams.set("maxResults", "5");
      url.searchParams.set("q", `${seed} ideas`);
      url.searchParams.set("key", key);

      const res = await fetch(url.toString(), {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`YouTube API responded ${res.status}`);
      const json = (await res.json()) as {
        items?: { snippet?: { title?: string } }[];
      };
      const videoTitles = (json.items ?? [])
        .map((i) => (i.snippet?.title ?? "").trim())
        .filter(Boolean);
      if (videoTitles.length > 0) out.push({ seed, videoTitles });
    }),
  );

  return out.length > 0 ? out : null;
}

/**
 * Runs all configured research sources in parallel. Returns null only when no
 * source produced anything (no keys / all failed) so Nova still runs.
 */
export async function fetchMarketResearch(
  opts?: ResearchSeedOptions,
): Promise<MarketResearchContext | null> {
  const seeds = await resolveResearchSeeds(opts);
  const [etsy, trends, youtube] = await Promise.all([
    fetchEtsyMarketContext(process.env.ETSY_CLIENT_ID ?? "").catch(() => null),
    fetchGoogleTrends(seeds).catch(() => null),
    fetchYouTubeBuzz(seeds).catch(() => null),
  ]);

  const sources: string[] = [];
  if (etsy) sources.push("etsy");
  if (trends) sources.push("google_trends");
  if (youtube) sources.push("youtube");
  if (sources.length === 0) return null;

  return {
    etsy,
    trends,
    youtube,
    sources,
    fetchedAt: new Date().toISOString(),
  };
}

/** Format the combined research as a compact string for the LLM prompt. */
export function formatMarketResearchForPrompt(
  ctx: MarketResearchContext,
): string {
  const parts: string[] = [];

  if (ctx.etsy) {
    parts.push(formatEtsyContextForPrompt(ctx.etsy));
  }

  if (ctx.trends?.length) {
    const lines = [
      "RISING GOOGLE TRENDS (search demand — lean into emerging interest):",
    ];
    for (const t of ctx.trends) {
      lines.push(`  • ${t.seed}: ${t.queries.join(", ")}`);
    }
    parts.push(lines.join("\n"));
  }

  if (ctx.youtube?.length) {
    const lines = [
      "YOUTUBE BUZZ (content people make/watch — signals passionate audiences):",
    ];
    for (const y of ctx.youtube) {
      lines.push(`  • ${y.seed}:`);
      y.videoTitles.slice(0, 4).forEach((title) => lines.push(`     - ${title}`));
    }
    parts.push(lines.join("\n"));
  }

  parts.push(
    "Synthesize across ALL sources above: target niches with rising demand and passionate audiences that are underserved by existing Etsy listings.",
  );

  return parts.join("\n\n");
}
