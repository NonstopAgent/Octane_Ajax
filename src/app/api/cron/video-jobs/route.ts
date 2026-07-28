/**
 * GET /api/cron/video-jobs — backstop drain for the video render queue (see
 * vercel.json). Finishes renders that completed while the operator's app was
 * closed. Security: Vercel sends CRON_SECRET as a Bearer token.
 */
export const maxDuration = 120;

import { NextResponse, type NextRequest } from "next/server";
import { resolveCronOperator } from "@/lib/auth/cron";
import { drainVideoJobs } from "@/lib/ajax/video/jobs";

export async function GET(req: NextRequest) {
  const cron = await resolveCronOperator(req);
  if (!cron.ok) return cron.response;
  const { supabase, userId } = cron;

  try {
    const summary = await drainVideoJobs(supabase, userId);
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error("[cron/video-jobs] error", err);
    return NextResponse.json(
      { ok: false, error: "Video-jobs cron failed." },
      { status: 500 },
    );
  }
}
