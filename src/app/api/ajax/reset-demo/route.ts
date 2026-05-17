import { NextResponse } from "next/server";
import { resetDemoData, SimulatorError } from "@/lib/ajax/simulator";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/ajax/reset-demo
 * Deletes the current user's demo pipeline rows and reseeds Nova / Forge / Pixel.
 */
export async function POST() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError) {
      return NextResponse.json(
        { ok: false, error: "Authentication failed.", details: authError.message },
        { status: 401 },
      );
    }

    if (!user) {
      return NextResponse.json(
        {
          ok: false,
          error: "Unauthorized. Sign in with Supabase Auth to reset demo data.",
        },
        { status: 401 },
      );
    }

    const summary = await resetDemoData(supabase, user.id);

    return NextResponse.json(summary);
  } catch (err) {
    if (err instanceof SimulatorError) {
      console.error("[reset-demo]", err.message, err.cause);
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message },
        { status: 500 },
      );
    }

    console.error("[reset-demo] unexpected error", err);
    return NextResponse.json(
      { ok: false, error: "An unexpected error occurred while resetting demo data." },
      { status: 500 },
    );
  }
}
