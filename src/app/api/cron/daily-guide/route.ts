/**
 * GET /api/cron/daily-guide — Sage writes one gift guide per day (vercel.json,
 * 07:30 UTC). Also callable as POST by the signed-in operator to force a
 * guide immediately (used for seeding/testing).
 */
export const maxDuration = 120;

import { NextResponse, type NextRequest } from "next/server";
import { resolveCronOperator } from "@/lib/auth/cron";
import { generateDailyGuide } from "@/lib/affiliate/guide-writer";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const cron = await resolveCronOperator(req);
  if (!cron.ok) return cron.response;
  const { supabase, userId } = cron;
  try {
    const result = await generateDailyGuide(supabase, userId);
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "failed" },
      { status: 500 },
    );
  }
}

/** Operator-triggered (session auth) — force a guide now. */
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
    const result = await generateDailyGuide(supabase, user.id);
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "failed" },
      { status: 500 },
    );
  }
}
