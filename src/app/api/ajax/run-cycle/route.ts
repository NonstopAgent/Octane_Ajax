export const maxDuration = 10;

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/ajax/run-cycle
 * @deprecated Use staged pipeline: POST /api/ajax/run-nova then POST /api/ajax/run-forge.
 * Keeps a single blocking Nova+Forge request from exceeding Vercel serverless limits.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      {
        ok: false,
        error: "Unauthorized. Sign in to run the Ajax pipeline.",
      },
      { status: 401 },
    );
  }

  return NextResponse.json(
    {
      ok: false,
      code: "STAGED_PIPELINE_REQUIRED",
      error:
        "Run-cycle is split for Vercel timeouts. Call POST /api/ajax/run-nova, then POST /api/ajax/run-forge (optional body: { runId }). Generate PDF manually on /review.",
      steps: ["/api/ajax/run-nova", "/api/ajax/run-forge"],
    },
    { status: 400 },
  );
}
