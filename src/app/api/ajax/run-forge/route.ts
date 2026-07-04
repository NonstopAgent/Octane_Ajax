export const maxDuration = 60;

import { NextResponse } from "next/server";
import {
  CycleBlockedError,
  runForgeStep,
  SimulatorError,
} from "@/lib/ajax/simulator";
import { getActiveBusinessId } from "@/lib/businesses/active";
import { createClient } from "@/lib/supabase/server";

type ForgeBody = {
  runId?: string;
};

/** POST /api/ajax/run-forge — Forge listing step (separate Vercel budget from Nova). */
export async function POST(request: Request) {
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
          error: "Unauthorized. Sign in with Supabase Auth to run Forge.",
        },
        { status: 401 },
      );
    }

    let runId: string | undefined;
    try {
      const body = (await request.json()) as ForgeBody;
      if (typeof body?.runId === "string" && body.runId.trim()) {
        runId = body.runId.trim();
      }
    } catch {
      // empty body is fine — Forge resolves the latest Nova run
    }

    const businessId = await getActiveBusinessId(supabase, user.id);
    const summary = await runForgeStep(supabase, user.id, { runId }, businessId);
    return NextResponse.json(summary);
  } catch (err) {
    if (err instanceof CycleBlockedError) {
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message },
        { status: 409 },
      );
    }

    if (err instanceof SimulatorError) {
      console.error("[run-forge]", err.message, err.cause);
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message },
        { status: 500 },
      );
    }

    console.error("[run-forge] unexpected error", err);
    return NextResponse.json(
      { ok: false, error: "An unexpected error occurred while running Forge." },
      { status: 500 },
    );
  }
}
