/**
 * Etsy analytics poller (Manus Part 3) — server only.
 *
 * Etsy exposes only LIFETIME views + num_favorers per listing (no daily series),
 * so we snapshot them once a day into `listing_performance_snapshots` and derive
 * velocity from the deltas. Revenue + orders are attributed per listing from
 * receipt transactions (requires the `transactions_r` OAuth scope — shops that
 * authorized before it was added simply record 0 revenue until they reconnect).
 *
 * Never throws on the happy path: every external call degrades to empty so the
 * daily cron always records what it can.
 */
import {
  createEtsyAdapter,
  EtsyAdapterError,
  type EtsyShopListing,
} from "@/lib/ajax/adapters/etsy";
import { refreshEtsyToken } from "@/lib/ajax/etsy-auth";
import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";

export type EtsySnapshotResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  snapshotted: number;
  totalRevenueCents: number;
  totalOrders: number;
  revenueScopeMissing: boolean;
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

export async function runEtsyAnalyticsSnapshot(
  supabase: Supabase,
  userId: string,
): Promise<EtsySnapshotResult> {
  let credentials;
  try {
    credentials = await refreshEtsyToken(userId, { supabase });
  } catch {
    return {
      ok: false,
      skipped: true,
      reason: "etsy_auth_failed",
      snapshotted: 0,
      totalRevenueCents: 0,
      totalOrders: 0,
      revenueScopeMissing: false,
    };
  }

  if (!credentials) {
    return {
      ok: true,
      skipped: true,
      reason: "etsy_not_connected",
      snapshotted: 0,
      totalRevenueCents: 0,
      totalOrders: 0,
      revenueScopeMissing: false,
    };
  }

  const adapter = createEtsyAdapter();

  let listings: EtsyShopListing[] = [];
  try {
    listings = await adapter.getShopListings(
      credentials.shop_id,
      credentials.access_token,
    );
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "listings_failed",
      snapshotted: 0,
      totalRevenueCents: 0,
      totalOrders: 0,
      revenueScopeMissing: false,
    };
  }

  // Revenue/orders since yesterday — needs transactions_r. Degrade gracefully.
  let receiptsByListing: Record<
    string,
    { orders: number; revenueCents: number }
  > = {};
  let revenueScopeMissing = false;
  try {
    const sinceUnix = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
    receiptsByListing = await adapter.getShopReceipts(
      credentials.shop_id,
      credentials.access_token,
      sinceUnix,
    );
  } catch (err) {
    if (
      err instanceof EtsyAdapterError &&
      (err.statusCode === 403 || err.statusCode === 401)
    ) {
      revenueScopeMissing = true;
    }
    receiptsByListing = {};
  }

  // Map Etsy listing id → our internal listing uuid (kept in gumroad_product_id).
  const etsyIds = listings.map((l) => l.listingId);
  const listingIdMap = new Map<string, string>();
  if (etsyIds.length > 0) {
    const { data: rows } = await supabase
      .from(TABLES.LISTINGS)
      .select("id, gumroad_product_id")
      .eq("user_id", userId)
      .in("gumroad_product_id", etsyIds);
    for (const row of rows ?? []) {
      if (row.gumroad_product_id) {
        listingIdMap.set(String(row.gumroad_product_id), row.id);
      }
    }
  }

  const snapshotDate = todayIsoDate();
  let totalRevenueCents = 0;
  let totalOrders = 0;
  const payload = listings.map((l) => {
    const r = receiptsByListing[l.listingId] ?? { orders: 0, revenueCents: 0 };
    totalRevenueCents += r.revenueCents;
    totalOrders += r.orders;
    return {
      user_id: userId,
      etsy_listing_id: l.listingId,
      listing_id: listingIdMap.get(l.listingId) ?? null,
      title: l.title || null,
      views: l.views,
      favorites: l.favorites,
      revenue_cents: r.revenueCents,
      orders: r.orders,
      snapshot_date: snapshotDate,
    };
  });

  if (payload.length > 0) {
    const { error } = await supabase
      .from(TABLES.LISTING_PERFORMANCE)
      .upsert(payload, {
        onConflict: "user_id,etsy_listing_id,snapshot_date",
      });
    if (error) {
      return {
        ok: false,
        reason: error.message,
        snapshotted: 0,
        totalRevenueCents,
        totalOrders,
        revenueScopeMissing,
      };
    }
  }

  return {
    ok: true,
    snapshotted: payload.length,
    totalRevenueCents,
    totalOrders,
    revenueScopeMissing,
  };
}

export type ListingVelocity = {
  etsyListingId: string;
  title: string;
  latestViews: number;
  viewsGained: number;
  orders: number;
};

export type PerformanceSummary = {
  revenueCentsThisWeek: number;
  ordersThisWeek: number;
  topByViewVelocity: ListingVelocity[];
  highViewsZeroOrders: ListingVelocity[];
  hasData: boolean;
};

export const EMPTY_PERFORMANCE_SUMMARY: PerformanceSummary = {
  revenueCentsThisWeek: 0,
  ordersThisWeek: 0,
  topByViewVelocity: [],
  highViewsZeroOrders: [],
  hasData: false,
};

/**
 * Aggregates the trailing `windowDays` of snapshots into the figures the
 * dashboard + War Room care about: weekly revenue/orders, listings gaining the
 * most views, and listings with traffic but no sales (title/price revision
 * candidates). Best-effort — returns an empty summary on any error.
 */
export async function fetchPerformanceSummary(
  supabase: Supabase,
  userId: string,
  windowDays = 7,
): Promise<PerformanceSummary> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const { data, error } = await supabase
    .from(TABLES.LISTING_PERFORMANCE)
    .select(
      "etsy_listing_id, title, views, favorites, revenue_cents, orders, snapshot_date",
    )
    .eq("user_id", userId)
    .gte("snapshot_date", since)
    .order("snapshot_date", { ascending: true });

  if (error || !data || data.length === 0) {
    return EMPTY_PERFORMANCE_SUMMARY;
  }

  type Agg = {
    title: string;
    firstViews: number;
    lastViews: number;
    orders: number;
  };
  const byListing = new Map<string, Agg>();
  let revenueCentsThisWeek = 0;
  let ordersThisWeek = 0;

  for (const row of data) {
    const id = row.etsy_listing_id;
    const views = Number(row.views ?? 0);
    const existing = byListing.get(id);
    if (!existing) {
      byListing.set(id, {
        title: row.title ?? "",
        firstViews: views,
        lastViews: views,
        orders: Number(row.orders ?? 0),
      });
    } else {
      existing.lastViews = views; // rows are ascending by date → last wins
      if (row.title) existing.title = row.title;
      existing.orders += Number(row.orders ?? 0);
    }
    revenueCentsThisWeek += Number(row.revenue_cents ?? 0);
    ordersThisWeek += Number(row.orders ?? 0);
  }

  const velocities: ListingVelocity[] = [...byListing.entries()].map(
    ([etsyListingId, a]) => ({
      etsyListingId,
      title: a.title || `Listing ${etsyListingId}`,
      latestViews: a.lastViews,
      viewsGained: Math.max(0, a.lastViews - a.firstViews),
      orders: a.orders,
    }),
  );

  const topByViewVelocity = [...velocities]
    .sort((x, y) => y.viewsGained - x.viewsGained)
    .slice(0, 5);
  const highViewsZeroOrders = velocities
    .filter((v) => v.orders === 0 && v.latestViews > 0)
    .sort((x, y) => y.latestViews - x.latestViews)
    .slice(0, 5);

  return {
    revenueCentsThisWeek,
    ordersThisWeek,
    topByViewVelocity,
    highViewsZeroOrders,
    hasData: true,
  };
}
