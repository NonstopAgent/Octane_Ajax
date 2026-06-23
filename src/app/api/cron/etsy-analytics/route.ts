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
import { runEtsyAnalyticsSnapshot } from "@/lib/ajax/analytics/etsy-snapshots";
import { createServiceClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const operatorEmail = process.env.OPERATOR_EMAIL;
  if (!operatorEmail) {
    return NextResponse.json(
      { ok: false, error: "OPERATOR_EMAIL env var not set." },
      { status: 500 },
    );
  }

  try {
    const supabase = createServiceClient();
    const { data: userList, error: listError } =
      await supabase.auth.admin.listUsers();
    if (listError) {
      return NextResponse.json(
        { ok: false, error: `Failed to list users: ${listError.message}` },
        { status: 500 },
      );
    }

    const operator = userList.users.find(
      (u) => u.email?.toLowerCase() === operatorEmail.toLowerCase(),
    );
    if (!operator) {
      return NextResponse.json(
        { ok: false, error: `No user found with email ${operatorEmail}.` },
        { status: 404 },
      );
    }

    const result = await runEtsyAnalyticsSnapshot(supabase, operator.id);
    return NextResponse.json({ ...result });
  } catch (err) {
    console.error("[cron/etsy-analytics] unexpected error", err);
    return NextResponse.json(
      { ok: false, error: "Unexpected error during analytics cron." },
      { status: 500 },
    );
  }
}
