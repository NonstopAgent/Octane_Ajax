// 60s is the Vercel Hobby ceiling. Nova = market research (~8s) + a single,
// time-boxed ideation LLM call (see nova/service), which fits comfortably here.
export const maxDuration = 60;

import { NextResponse } from "next/server";
import {
  CycleBlockedError,
  runNovaStep,
  SimulatorError,
} from "@/lib/ajax/simulator";
import { createClient } from "@/lib/supabase/server";

/** POST /api/ajax/run-nova — Nova ideation step (Vercel-safe, no Forge LLM). */
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
          error: "Unauthorized. Sign in with Supabase Auth to run Nova.",
        },
        { status: 401 },
      );
    }

    const summary = await runNovaStep(supabase, user.id);
    return NextResponse.json(summary);
  } catch (err) {
    if (err instanceof CycleBlockedError) {
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message },
        { status: 409 },
      );
    }

    if (err instanceof SimulatorError) {
      console.error("[run-nova]", err.message, err.cause);
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message },
        { status: 500 },
      );
    }

    console.error("[run-nova] unexpected error", err);
    return NextResponse.json(
      { ok: false, error: "An unexpected error occurred while running Nova." },
      { status: 500 },
    );
  }
}
