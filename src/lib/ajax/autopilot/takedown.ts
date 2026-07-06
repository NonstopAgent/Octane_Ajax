/**
 * Shop portfolio management — take down (unpublish) underperforming listings.
 *
 * Two jobs:
 *  1. `selectTakedownCandidate` — a PURE decision that picks the weakest listing
 *     to retire, protecting anything that has ever sold or is still young.
 *  2. `takeDownListing` — the executor: unpublish via Printify (removes it from
 *     the Etsy shop), flip the listing to `archived`, log a factory event.
 *
 * REVERSIBLE by design — archiving + Printify unpublish can be re-published later.
 * Never throws: a failed takedown is logged and the loop continues.
 */
import {
  createPrintifyAdapter,
  isPrintifyConfigured,
} from "@/lib/ajax/adapters/printify";
import { AGENT_SLUGS, ROOM_SLUGS } from "@/lib/ajax/constants";
import type { Json } from "@/lib/supabase/database.types";
import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";

/** A listing has to be at least this old before it can ever be retired (days). */
export const TAKEDOWN_MIN_AGE_DAYS = Number(
  process.env.TAKEDOWN_MIN_AGE_DAYS ?? 30,
);
/** At capacity, only prune listings weaker than this many lifetime views. */
export const TAKEDOWN_WEAK_VIEWS = Number(process.env.TAKEDOWN_WEAK_VIEWS ?? 20);
/** Even under capacity, retire egregiously dead listings (older than this...). */
export const TAKEDOWN_DEAD_AGE_DAYS = Number(
  process.env.TAKEDOWN_DEAD_AGE_DAYS ?? 45,
);
/** ...with fewer than this many lifetime views. */
export const TAKEDOWN_DEAD_VIEWS = Number(process.env.TAKEDOWN_DEAD_VIEWS ?? 5);

export type TakedownCandidate = {
  listingId: string;
  title: string;
  printifyProductId: string | null;
  ageDays: number | null;
  views: number;
  orders: number;
  revenueCents: number;
};

/**
 * Pick the single weakest listing to retire, or null if none qualify.
 * Ironclad protections: never a listing with ANY order/revenue, never one younger
 * than TAKEDOWN_MIN_AGE_DAYS. At capacity we prune the weakest dead-weight item to
 * make room; under capacity we only retire egregiously dead listings.
 */
export function selectTakedownCandidate(
  candidates: TakedownCandidate[],
  opts: { atCapacity: boolean },
): TakedownCandidate | null {
  const eligible = candidates.filter(
    (c) =>
      c.orders === 0 &&
      c.revenueCents === 0 &&
      c.ageDays != null &&
      c.ageDays >= TAKEDOWN_MIN_AGE_DAYS,
  );
  if (eligible.length === 0) return null;

  const pool = opts.atCapacity
    ? eligible.filter((c) => c.views < TAKEDOWN_WEAK_VIEWS)
    : eligible.filter(
        (c) =>
          (c.ageDays ?? 0) >= TAKEDOWN_DEAD_AGE_DAYS &&
          c.views < TAKEDOWN_DEAD_VIEWS,
      );
  if (pool.length === 0) return null;

  // Weakest first: fewest views, then oldest.
  return [...pool].sort(
    (a, b) => a.views - b.views || (b.ageDays ?? 0) - (a.ageDays ?? 0),
  )[0];
}

export type TakedownResult = {
  ok: boolean;
  listingId: string;
  title: string;
  reason: string;
};

/**
 * Execute a takedown: unpublish from Etsy via Printify, archive the listing, log it.
 * Best-effort and reversible. `printifyProductId` comes from the listing's stored
 * gumroad_product_id (Printify product id captured at publish time).
 */
export async function takeDownListing(
  supabase: Supabase,
  userId: string,
  input: {
    listingId: string;
    title: string;
    printifyProductId: string | null;
    reason: string;
  },
): Promise<TakedownResult> {
  const { listingId, title, printifyProductId, reason } = input;
  let unpublished = false;
  let note = reason;

  if (printifyProductId && isPrintifyConfigured()) {
    try {
      await createPrintifyAdapter().unpublishProduct(printifyProductId);
      unpublished = true;
    } catch (err) {
      note = `${reason} (Printify unpublish failed: ${
        err instanceof Error ? err.message : "unknown"
      } — archived locally)`;
    }
  } else {
    note = `${reason} (no Printify product id / not configured — archived locally)`;
  }

  const { error } = await supabase
    .from(TABLES.LISTINGS)
    .update({ status: "archived" })
    .eq("id", listingId)
    .eq("user_id", userId);
  if (error) {
    return { ok: false, listingId, title, reason: `DB archive failed: ${error.message}` };
  }

  try {
    await supabase.from(TABLES.EVENTS).insert({
      user_id: userId,
      event_type: "listing_taken_down",
      message: `Retired "${title}" from the shop — ${note}`,
      agent_slug: AGENT_SLUGS.PIXEL,
      room: ROOM_SLUGS.STOREFRONT,
      metadata: {
        listingId,
        printifyProductId,
        unpublishedFromEtsy: unpublished,
        reason,
      } as Json,
    });
  } catch {
    // Event logging must never break the loop.
  }

  return { ok: true, listingId, title, reason: note };
}

/**
 * Gather every currently-published listing with the signals the takedown decision
 * needs: age, latest performance snapshot (views/orders/revenue), and a fulfillment-
 * order count. Orders/revenue from EITHER source protect a listing from retirement.
 */
export async function gatherTakedownCandidates(
  supabase: Supabase,
  userId: string,
): Promise<TakedownCandidate[]> {
  const { data: listings } = await supabase
    .from(TABLES.LISTINGS)
    .select("id, title, gumroad_product_id, created_at")
    .eq("user_id", userId)
    .eq("status", "published");
  if (!listings || listings.length === 0) return [];

  const ids = listings.map((l) => l.id as string);

  const { data: perf } = await supabase
    .from(TABLES.LISTING_PERFORMANCE)
    .select("listing_id, views, orders, revenue_cents, snapshot_date")
    .eq("user_id", userId)
    .in("listing_id", ids)
    .order("snapshot_date", { ascending: false });
  const perfByListing = new Map<
    string,
    { views: number; orders: number; revenueCents: number }
  >();
  for (const row of perf ?? []) {
    const lid = String(row.listing_id);
    if (perfByListing.has(lid)) continue; // first row per listing = latest snapshot
    perfByListing.set(lid, {
      views: row.views ?? 0,
      orders: row.orders ?? 0,
      revenueCents: row.revenue_cents ?? 0,
    });
  }

  const { data: orders } = await supabase
    .from(TABLES.ORDER_QUEUE)
    .select("listing_id")
    .eq("user_id", userId)
    .in("listing_id", ids);
  const orderCount = new Map<string, number>();
  for (const row of orders ?? []) {
    const lid = String(row.listing_id);
    orderCount.set(lid, (orderCount.get(lid) ?? 0) + 1);
  }

  const now = Date.now();
  return listings.map((l) => {
    const lid = l.id as string;
    const p = perfByListing.get(lid);
    const createdAt = l.created_at ? Date.parse(l.created_at as string) : NaN;
    const ageDays = Number.isFinite(createdAt)
      ? (now - createdAt) / 86_400_000
      : null;
    return {
      listingId: lid,
      title: (l.title as string) ?? "Untitled listing",
      printifyProductId: (l.gumroad_product_id as string) ?? null,
      ageDays,
      views: p?.views ?? 0,
      orders: Math.max(p?.orders ?? 0, orderCount.get(lid) ?? 0),
      revenueCents: p?.revenueCents ?? 0,
    };
  });
}
