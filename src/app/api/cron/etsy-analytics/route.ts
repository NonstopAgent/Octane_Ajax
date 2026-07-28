/**
 * GET /api/cron/etsy-analytics
 *
 * Daily Vercel Cron (see vercel.json). Snapshots the operator's Etsy listing
 * performance (lifetime views + favorites) and attributes recent revenue/orders
 * per listing into `listing_performance_snapshots`. Feeds the Dashboard
 * Performance section + the War Room archive.
 *
 * Security: Vercel sends CRON_SECRET as a Bearer token.
 */
export const maxDuration = 120;

import { NextResponse, type NextRequest } from "next/server";
import { resolveCronOperator } from "@/lib/auth/cron";
import { runEtsyAnalyticsSnapshot } from "@/lib/ajax/analytics/etsy-snapshots";

export async function GET(req: NextRequest) {
  const cron = await resolveCronOperator(req);
  if (!cron.ok) return cron.response;
  const { supabase, userId } = cron;

  try {
    const result = await runEtsyAnalyticsSnapshot(supabase, userId);
    return NextResponse.json({ ...result });
  } catch (err) {
    console.error("[cron/etsy-analytics] unexpected error", err);
    return NextResponse.json(
      { ok: false, error: "Unexpected error during analytics cron." },
      { status: 500 },
    );
  }
}
