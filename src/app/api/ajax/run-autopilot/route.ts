// Full autopilot pass, operator-triggered. Same work as the hourly cron
// (audit, medic fixes, gallery heals, video refresh, reviews, social) but
// fired on demand from a signed-in browser — "update all the listings NOW"
// shouldn't wait for the top of the hour. Navigation-friendly GET: driver
// tabs and a plain address-bar visit both work. Session auth.
export const maxDuration = 800;

import { NextResponse } from "next/server";
import { runShopAutopilot } from "@/lib/ajax/autopilot/service";
import { createClient } from "@/lib/supabase/server";
import { requireOperator } from "@/lib/auth/operator";

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized." },
        { status: 401 },
      );
    }

    // Operator-only (2026-07-25 audit, H10): signed-in is not authorized —
    // this surface mutates the ONE live shop on process-wide credentials.
    const operatorCheck = requireOperator(user);
    if (!operatorCheck.ok) {
      return NextResponse.json(
        { ok: false, error: operatorCheck.error },
        { status: operatorCheck.status },
      );
    }
    const summary = await runShopAutopilot(supabase, user.id);
    // `ok` mirrors the pass (2026-07-25 audit, M10c) — it used to be
    // hardcoded true, so a manual run that failed on every listing still
    // reported success to the operator who triggered it.
    return NextResponse.json({ ok: summary.ok, summary });
  } catch (err) {
    console.error("[run-autopilot:get]", err);
    return NextResponse.json(
      { ok: false, error: "Autopilot pass failed — see logs." },
      { status: 500 },
    );
  }
}
