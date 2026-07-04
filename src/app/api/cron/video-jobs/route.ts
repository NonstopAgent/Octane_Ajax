/**
 * GET /api/cron/video-jobs — backstop drain for the video render queue (see
 * vercel.json). Finishes renders that completed while the operator's app was
 * closed. Security: Vercel sends CRON_SECRET as a Bearer token.
 */
export const maxDuration = 120;

import { NextResponse, type NextRequest } from "next/server";
import { drainVideoJobs } from "@/lib/ajax/video/jobs";
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
    const { data: userList, error } = await supabase.auth.admin.listUsers();
    if (error) {
      return NextResponse.json(
        { ok: false, error: `Failed to list users: ${error.message}` },
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
    const summary = await drainVideoJobs(supabase, operator.id);
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error("[cron/video-jobs] error", err);
    return NextResponse.json(
      { ok: false, error: "Video-jobs cron failed." },
      { status: 500 },
    );
  }
}
