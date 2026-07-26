/**
 * POST /api/ajax/organize-store — operator-triggered storefront cleanup:
 * ensures shop sections exist (Mugs / Apparel / Art Prints), assigns every
 * active listing to its section, and features the 4 most-viewed listings.
 * Idempotent; also re-applied automatically by the daily autopilot pass.
 */
export const maxDuration = 120;

import { NextResponse } from "next/server";
import { organizeStore } from "@/lib/etsy/organize-store";
import { createClient } from "@/lib/supabase/server";
import { requireOperator } from "@/lib/auth/operator";

export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized. Sign in first." },
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
    const summary = await organizeStore(supabase, user.id);
    return NextResponse.json(summary, { status: summary.ok ? 200 : 500 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "failed" },
      { status: 500 },
    );
  }
}
