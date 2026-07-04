export const maxDuration = 60;

import { NextResponse } from "next/server";
import { drainVideoJobs } from "@/lib/ajax/video/jobs";
import { createClient } from "@/lib/supabase/server";

/** POST /api/ajax/video/poll — finish any renders that are ready (called by the
 * client while the operator is active). Attaches Etsy videos + posts social. */
export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      );
    }
    const summary = await drainVideoJobs(supabase, user.id);
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error("[video/poll] error", err);
    return NextResponse.json(
      { ok: false, error: "Video poll failed." },
      { status: 500 },
    );
  }
}
