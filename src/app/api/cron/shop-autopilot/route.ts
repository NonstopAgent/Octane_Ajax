/**
 * GET /api/cron/shop-autopilot
 *
 * Hourly Vercel Cron (vercel.json). Ajax's continuous shop-improvement loop:
 * audits live listings, auto-fixes small SEO gaps, queues big recommendations,
 * refreshes marketing for stalled listings, and keeps the factory producing
 * while the shop is under its listing target.
 *
 * Security: Vercel sends CRON_SECRET as Bearer token; 401 without it.
 */
// 800s under Fluid Compute (Vercel clamps to the plan limit if lower). The
// pass is ordered quality-first with production LAST, so a timeout only ever
// costs the optional new-product step at the tail — never enrichment.
export const maxDuration = 800;

import { NextResponse, type NextRequest } from "next/server";
import { runShopAutopilot } from "@/lib/ajax/autopilot/service";
import { createServiceClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
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

    const result = await runShopAutopilot(supabase, operator.id);

    // Status policy (2026-07-25 audit, M10c). This route used to return 200
    // unconditionally, so Vercel's cron dashboard showed a green check for a
    // pass that errored on 13 of 25 listings — the operator's only monitoring
    // surface was lying. But a 5xx is also what makes a platform re-invoke a
    // job, and re-running this pass can cost a second paid image generation.
    // So:
    //   red (500)  → the loop is BROKEN: Etsy unreachable, or errors with
    //                nothing accomplished. Worth re-running; must be visible.
    //   200 + ok:false → partial failure. Surfaced by the system_alerts banner
    //                in Mission Control instead of by an ambiguous red check.
    const brokenLoop =
      !result.skipped &&
      (!result.etsyConnected ||
        (result.errors.length > 0 && result.audited === 0));
    return NextResponse.json(result, { status: brokenLoop ? 500 : 200 });
  } catch (err) {
    console.error("[cron/shop-autopilot] unexpected error", err);
    return NextResponse.json(
      { ok: false, error: "Unexpected error during autopilot pass." },
      { status: 500 },
    );
  }
}
