/**
 * War Room signals — the NEW intelligence the strategist now reasons over,
 * beyond the internal archive: REAL external market demand (MARKET_KEYWORDS) and
 * the deterministic store-QA shop-health readout. Also used to render the
 * always-on "state of the shop" command strip on the War Room page.
 */
import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";
import { auditStore } from "@/lib/ajax/store-qa/audit";
import { fetchStoreListingsForQa } from "@/lib/ajax/store-qa/queries";

export type MarketOpportunity = {
  term: string;
  searchesPerMonth: number | null;
  competingListings: number | null;
};

export type ShopHealthSummary = {
  overallScore: number;
  listingCount: number;
  critical: number;
  warning: number;
  topFixes: string[];
};

export type WarRoomSignals = {
  marketOpportunities: MarketOpportunity[];
  shopHealth: ShopHealthSummary;
};

/** Top real search terms by demand (from the ingested MARKET_KEYWORDS data). */
export async function fetchMarketOpportunities(
  supabase: Supabase,
  userId: string,
  limit = 12,
): Promise<MarketOpportunity[]> {
  try {
    const { data } = await supabase
      .from(TABLES.MARKET_KEYWORDS)
      .select("term, searches_per_month, competing_listings")
      .eq("user_id", userId)
      .eq("active", true)
      .order("searches_per_month", { ascending: false, nullsFirst: false })
      .limit(limit);
    return (data ?? [])
      .map((r) => ({
        term: (r.term ?? "").trim(),
        searchesPerMonth: r.searches_per_month ?? null,
        competingListings: r.competing_listings ?? null,
      }))
      .filter((r) => r.term.length > 0);
  } catch {
    return [];
  }
}

/** Assemble the real market + shop-health signals for the strategist and the UI. */
export async function fetchWarRoomSignals(
  supabase: Supabase,
  userId: string,
): Promise<WarRoomSignals> {
  const [opps, qaListings] = await Promise.all([
    fetchMarketOpportunities(supabase, userId),
    fetchStoreListingsForQa(supabase, userId),
  ]);
  const report = auditStore(qaListings);
  return {
    marketOpportunities: opps,
    shopHealth: {
      overallScore: report.overallScore,
      listingCount: report.listingCount,
      critical: report.counts.critical,
      warning: report.counts.warning,
      topFixes: report.topFixes.slice(0, 5),
    },
  };
}

/** Pure formatter — turns the signals into a prompt block for the strategist. */
export function formatSignalsForPrompt(s: WarRoomSignals): string {
  const opp = s.marketOpportunities.length
    ? s.marketOpportunities
        .map((o) => {
          const d =
            o.searchesPerMonth != null ? `${o.searchesPerMonth}/mo` : "demand n/a";
          const c =
            o.competingListings != null
              ? `${o.competingListings} competing`
              : "supply n/a";
          return `- "${o.term}": ${d} vs ${c}`;
        })
        .join("\n")
    : "- (no real keyword demand data yet — recommend ingesting proven search terms)";
  const h = s.shopHealth;
  const fixes = h.topFixes.length
    ? h.topFixes.map((f) => `  - ${f}`).join("\n")
    : "  - (none)";
  return `## REAL MARKET OPPORTUNITY (demand vs. supply — a term with more monthly searches than competing listings is open; a saturated one is a red ocean)
${opp}

## SHOP HEALTH (deterministic store-QA sweep — the storefront buyers actually see)
Score ${h.overallScore}/100 across ${h.listingCount} listing(s) — ${h.critical} critical, ${h.warning} warnings.
Top fixes to raise it:
${fixes}`;
}
