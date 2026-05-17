export const maxDuration = 30;

import { NextResponse } from "next/server";
import {
  NoQueuedContentError,
  PixelSimulatorError,
  runPixelMarketing,
} from "@/lib/ajax/pixel-simulator";
import { createClient } from "@/lib/supabase/server";

/** POST /api/ajax/run-pixel — demo marketing pass for queued content_jobs. */
export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized. Sign in to run Pixel." },
        { status: 401 },
      );
    }

    const result = await runPixelMarketing(supabase, user.id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof NoQueuedContentError) {
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message },
        { status: 409 },
      );
    }

    if (err instanceof PixelSimulatorError) {
      console.error("[run-pixel]", err.message, err.cause);
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message },
        { status: 500 },
      );
    }

    console.error("[run-pixel] unexpected error", err);
    return NextResponse.json(
      { ok: false, error: "Failed to run Pixel marketing simulation." },
      { status: 500 },
    );
  }
}
