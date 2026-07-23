// Full autopilot pass, operator-triggered. Same work as the hourly cron
// (audit, medic fixes, gallery heals, video refresh, reviews, social) but
// fired on demand from a signed-in browser — "update all the listings NOW"
// shouldn't wait for the top of the hour. Navigation-friendly GET: driver
// tabs and a plain address-bar visit both work. Session auth.
export const maxDuration = 800;

import { NextResponse } from "next/server";
import { runShopAutopilot } from "@/lib/ajax/autopilot/service";
import { createClient } from "@/lib/supabase/server";

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
    const summary = await runShopAutopilot(supabase, user.id);
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    console.error("[run-autopilot:get]", err);
    return NextResponse.json(
      { ok: false, error: "Autopilot pass failed — see logs." },
      { status: 500 },
    );
  }
}
