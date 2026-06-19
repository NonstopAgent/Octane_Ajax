/**
 * GET /api/cron/war-room
 *
 * Weekly Vercel Cron (see vercel.json). Runs the War Room for the operator
 * account so a fresh strategy briefing appears without manual triggering.
 * Security: Vercel sends CRON_SECRET as a Bearer token.
 */
export const maxDuration = 120;

import { NextResponse, type NextRequest } from "next/server";
import { runWarRoom } from "@/lib/ajax/warroom/service";
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

    const result = await runWarRoom(supabase, operator.id);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[cron/war-room] unexpected error", err);
    return NextResponse.json(
      { ok: false, error: "War Room cron failed." },
      { status: 500 },
    );
  }
}
