/**
 * GET /api/cron/war-room
 *
 * Weekly Vercel Cron (see vercel.json). Runs the War Room for the operator
 * account so a fresh strategy briefing appears without manual triggering.
 * Security: Vercel sends CRON_SECRET as a Bearer token.
 */
export const maxDuration = 120;

import { NextResponse, type NextRequest } from "next/server";
import { resolveCronOperator } from "@/lib/auth/cron";
import { runWarRoom } from "@/lib/ajax/warroom/service";

export async function GET(req: NextRequest) {
  const cron = await resolveCronOperator(req);
  if (!cron.ok) return cron.response;
  const { supabase, userId } = cron;

  try {
    const result = await runWarRoom(supabase, userId);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[cron/war-room] unexpected error", err);
    return NextResponse.json(
      { ok: false, error: "War Room cron failed." },
      { status: 500 },
    );
  }
}
