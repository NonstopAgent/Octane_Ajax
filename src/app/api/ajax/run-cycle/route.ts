export const maxDuration = 30;

import { NextResponse } from "next/server";
import {
  CycleBlockedError,
  runAjaxCycle,
  SimulatorError,
} from "@/lib/ajax/simulator";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/ajax/run-cycle
 * Runs one simulated Nova → Forge → Review Gate cycle for the signed-in user.
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
          error: "Unauthorized. Sign in with Supabase Auth to run the Ajax cycle.",
        },
        { status: 401 },
      );
    }

    const summary = await runAjaxCycle(supabase, user.id);

    return NextResponse.json(summary);
  } catch (err) {
    if (err instanceof CycleBlockedError) {
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message },
        { status: 409 },
      );
    }

    if (err instanceof SimulatorError) {
      console.error("[run-cycle]", err.message, err.cause);
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message },
        { status: 500 },
      );
    }

    console.error("[run-cycle] unexpected error", err);
    return NextResponse.json(
      { ok: false, error: "An unexpected error occurred while running the cycle." },
      { status: 500 },
    );
  }
}
