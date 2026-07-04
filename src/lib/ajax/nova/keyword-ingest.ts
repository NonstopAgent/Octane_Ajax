/**
 * Market Keyword Ingest — fills the MARKET_KEYWORDS table with REAL demand/supply
 * data so the Product Brain's market scorer fires on facts, not fallbacks.
 *
 * Two honest sources (never fabricated):
 *  1. Etsy Open API — real count of active listings for a term = competing_listings
 *     (supply). Available with ETSY_CLIENT_ID, no OAuth. Search volume isn't public,
 *     so searches_per_month is left null unless an operator provides it.
 *  2. Operator import — real search volume + competition the operator pulls from Etsy
 *     Marketplace Insights (or similar) and pastes in; stored as source 'manual'.
 *
 * Upserts preserve a manually-set searches_per_month: the Etsy refresh only writes
 * competing_listings, so real demand numbers you entered are never clobbered.
 */
import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";
import type { TablesInsert, TablesUpdate } from "@/lib/supabase/database.types";

const ETSY_API_BASE = "https://openapi.etsy.com/v3/application";

/** Proven long-tail pet-buyer search phrases to ground the first shop in real data. */
export const PET_SEED_TERMS = [
  "personalized dog mom gift",
  "cat mom coffee mug",
  "rescue dog mom shirt",
  "gotcha day gift",
  "pet memorial gift",
  "dog dad gift",
  "custom pet portrait",
  "dog lover tumbler",
  "personalized cat dad gift",
  "pet loss sympathy gift",
  "senior dog gift",
  "new puppy gift",
  "dog mom birthday gift",
  "personalized dog ornament",
] as const;

export type ManualKeyword = {
  term: string;
  searchesPerMonth?: number | null;
  competingListings?: number | null;
  notes?: string | null;
};

export type IngestResult = {
  upserted: number;
  inserted: number;
  updated: number;
  source: string;
  terms: string[];
};

/** True when live Etsy competition data can be fetched. Etsy's x-api-key needs
 * BOTH the keystring and the shared secret, so require both. */
export function isKeywordIngestConfigured(): boolean {
  return Boolean(
    process.env.ETSY_CLIENT_ID?.trim() && process.env.ETSY_CLIENT_SECRET?.trim(),
  );
}

/** Fetch the REAL count of active Etsy listings matching a term (supply signal). */
export async function fetchEtsyListingCount(
  term: string,
  apiKey: string,
): Promise<number | null> {
  const url = new URL(`${ETSY_API_BASE}/listings/active`);
  url.searchParams.set("keywords", term);
  url.searchParams.set("limit", "1");
  url.searchParams.set("type", "physical");

  const secret = process.env.ETSY_CLIENT_SECRET?.trim();
  const apiKeyHeader = secret ? `${apiKey}:${secret}` : apiKey;
  try {
    const res = await fetch(url.toString(), {
      headers: { "x-api-key": apiKeyHeader, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { count?: number };
    return typeof json.count === "number" ? json.count : null;
  } catch {
    return null;
  }
}

type CountFetcher = (term: string, apiKey: string) => Promise<number | null>;

async function upsertKeywordRows(
  supabase: Supabase,
  userId: string,
  rows: Array<{
    term: string;
    competingListings?: number | null;
    searchesPerMonth?: number | null;
    source: string;
    notes?: string | null;
  }>,
): Promise<{ inserted: number; updated: number }> {
  const terms = rows.map((r) => r.term);
  const { data: existing } = await supabase
    .from(TABLES.MARKET_KEYWORDS)
    .select("id, term")
    .eq("user_id", userId)
    .in("term", terms);

  const idByTerm = new Map<string, string>(
    (existing ?? []).map((r) => [r.term as string, r.id as string]),
  );

  const inserts: TablesInsert<"market_keywords">[] = [];
  let updated = 0;

  for (const row of rows) {
    const existingId = idByTerm.get(row.term);
    if (existingId) {
      // Only write columns we actually have — preserves a manual search volume
      // when refreshing competition, and vice-versa.
      const patch: TablesUpdate<"market_keywords"> = {
        source: row.source,
        active: true,
      };
      if (row.competingListings !== undefined)
        patch.competing_listings = row.competingListings;
      if (row.searchesPerMonth !== undefined)
        patch.searches_per_month = row.searchesPerMonth;
      if (row.notes !== undefined) patch.notes = row.notes;
      const { error } = await supabase
        .from(TABLES.MARKET_KEYWORDS)
        .update(patch)
        .eq("id", existingId);
      if (!error) updated += 1;
    } else {
      inserts.push({
        user_id: userId,
        term: row.term,
        source: row.source,
        active: true,
        competing_listings: row.competingListings ?? null,
        searches_per_month: row.searchesPerMonth ?? null,
        notes: row.notes ?? null,
      });
    }
  }

  let inserted = 0;
  if (inserts.length > 0) {
    const { data, error } = await supabase
      .from(TABLES.MARKET_KEYWORDS)
      .insert(inserts)
      .select("id");
    if (!error) inserted = data?.length ?? inserts.length;
  }

  return { inserted, updated };
}

/**
 * Refresh REAL Etsy competing-listing counts for the given terms (pet seeds by
 * default) and persist them. `fetchCount` is injectable for tests.
 */
export async function refreshEtsyKeywordCounts(opts: {
  supabase: Supabase;
  userId: string;
  apiKey: string;
  terms?: readonly string[];
  fetchCount?: CountFetcher;
}): Promise<IngestResult> {
  const terms = (opts.terms ?? PET_SEED_TERMS).map((t) => t.trim()).filter(Boolean);
  const fetchCount = opts.fetchCount ?? fetchEtsyListingCount;

  const settled = await Promise.allSettled(
    terms.map(async (term) => ({
      term,
      count: await fetchCount(term, opts.apiKey),
    })),
  );

  const rows = settled
    .filter(
      (s): s is PromiseFulfilledResult<{ term: string; count: number | null }> =>
        s.status === "fulfilled" && s.value.count != null,
    )
    .map((s) => ({
      term: s.value.term,
      competingListings: s.value.count,
      source: "etsy_api",
    }));

  if (rows.length === 0) {
    return { upserted: 0, inserted: 0, updated: 0, source: "etsy_api", terms: [] };
  }

  const { inserted, updated } = await upsertKeywordRows(
    opts.supabase,
    opts.userId,
    rows,
  );
  return {
    upserted: inserted + updated,
    inserted,
    updated,
    source: "etsy_api",
    terms: rows.map((r) => r.term),
  };
}

/** Persist operator-provided REAL keyword numbers (e.g. Etsy Marketplace Insights). */
export async function saveManualKeywords(
  supabase: Supabase,
  userId: string,
  keywords: ManualKeyword[],
): Promise<IngestResult> {
  const rows = keywords
    .map((k) => ({
      term: (k.term ?? "").trim(),
      // Preserve undefined so an update only writes the columns the operator
      // actually provided — a demand-only save won't null a real Etsy count.
      searchesPerMonth: k.searchesPerMonth,
      competingListings: k.competingListings,
      notes: k.notes,
      source: "manual",
    }))
    .filter((r) => r.term.length > 0);

  if (rows.length === 0) {
    return { upserted: 0, inserted: 0, updated: 0, source: "manual", terms: [] };
  }

  const { inserted, updated } = await upsertKeywordRows(supabase, userId, rows);
  return {
    upserted: inserted + updated,
    inserted,
    updated,
    source: "manual",
    terms: rows.map((r) => r.term),
  };
}

/**
 * Bootstrap real Etsy competition data on the first Nova cycle: if the operator
 * has no keywords yet and the Etsy key is set, ingest the pet seeds once.
 * Best-effort and non-throwing so Nova always runs.
 */
export async function bootstrapKeywordsIfEmpty(opts: {
  supabase: Supabase;
  userId: string;
}): Promise<boolean> {
  const apiKey = process.env.ETSY_CLIENT_ID?.trim();
  if (!apiKey || !isKeywordIngestConfigured()) return false;
  try {
    const { count } = await opts.supabase
      .from(TABLES.MARKET_KEYWORDS)
      .select("id", { count: "exact", head: true })
      .eq("user_id", opts.userId)
      .eq("active", true);
    if ((count ?? 0) > 0) return false;
    const result = await refreshEtsyKeywordCounts({
      supabase: opts.supabase,
      userId: opts.userId,
      apiKey,
    });
    return result.upserted > 0;
  } catch {
    return false;
  }
}
