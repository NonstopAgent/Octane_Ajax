/**
 * POST /api/ajax/war-room/run — on-demand War Room analysis for the operator.
 * Runs in its own invocation (LLM over the archive can take ~30-60s).
 */
export const maxDuration = 120;

import { NextResponse } from "next/server";
import { runWarRoom } from "@/lib/ajax/warroom/service";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const result = await runWarRoom(supabase, user.id);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[war-room/run] unexpected error", err);
    return NextResponse.json(
      { ok: false, error: "War Room run failed." },
      { status: 500 },
    );
  }
}
