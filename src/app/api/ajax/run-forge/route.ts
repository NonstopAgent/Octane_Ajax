// 300 (was 60): the art gate adds up to two vision checks and a corrective
// artwork regeneration to the Forge step — worth every second versus
// shipping a bad product, but it no longer fits a 60s budget.
export const maxDuration = 300;

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

/**
 * GET variant — same Forge step, navigation-triggered. The operator drives
 * repairs and launches from a browser tab whose background-throttled fetches
 * kept silently dying; plain navigations are immune. Session auth applies.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized." },
        { status: 401 },
      );
    }
    const businessId = await getActiveBusinessId(supabase, user.id);
    const summary = await runForgeStep(supabase, user.id, {}, businessId);
    return NextResponse.json(summary);
  } catch (err) {
    if (err instanceof CycleBlockedError) {
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message },
        { status: 409 },
      );
    }
    if (err instanceof SimulatorError) {
      console.error("[run-forge:get]", err.message, err.cause);
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message },
        { status: 500 },
      );
    }
    console.error("[run-forge:get] unexpected error", err);
    return NextResponse.json(
      { ok: false, error: "An unexpected error occurred while running Forge." },
      { status: 500 },
    );
  }
}

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
