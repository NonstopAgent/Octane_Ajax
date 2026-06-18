/**
 * POD fulfillment for a single generation — runs in its OWN serverless
 * invocation so the slow gpt-image-1 + Printify work gets the full function
 * budget instead of sharing Forge's request budget (which caused listings to
 * get stuck at generation_status='generating').
 *
 * POST  /api/ajax/product-generations/:id/fulfill  → run/retry fulfillment
 * GET   /api/ajax/product-generations/:id/fulfill  → current status (for polling)
 */
export const maxDuration = 300; // dedicated budget for artwork + Printify (Vercel Pro)

import { NextResponse } from "next/server";
import {
  GenerationPodError,
  runGenerationPodJob,
} from "@/lib/product/generation-pod-runner";
import { createClient } from "@/lib/supabase/server";
import { TABLES } from "@/lib/supabase/schema";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id: generationId } = await context.params;
    if (!generationId) {
      return NextResponse.json(
        { ok: false, error: "Generation id is required." },
        { status: 400 },
      );
    }

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

    const result = await runGenerationPodJob(supabase, user.id, generationId);
    return NextResponse.json({ ok: result.ok, result });
  } catch (err) {
    if (err instanceof GenerationPodError) {
      return NextResponse.json(
        { ok: false, error: err.message },
        { status: err.httpStatus },
      );
    }
    console.error("[fulfill] unexpected error", err);
    return NextResponse.json(
      { ok: false, error: "POD fulfillment failed." },
      { status: 500 },
    );
  }
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id: generationId } = await context.params;
    if (!generationId) {
      return NextResponse.json(
        { ok: false, error: "Generation id is required." },
        { status: 400 },
      );
    }

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

    const { data, error } = await supabase
      .from(TABLES.GENERATIONS)
      .select("generation_status, mockup_storage_path")
      .eq("id", generationId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { ok: false, error: "Failed to load generation." },
        { status: 500 },
      );
    }

    if (!data) {
      return NextResponse.json(
        { ok: false, error: "Generation not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({
      ok: true,
      generationStatus: data.generation_status,
      hasMockup: Boolean(data.mockup_storage_path),
    });
  } catch (err) {
    console.error("[fulfill] status error", err);
    return NextResponse.json(
      { ok: false, error: "Failed to read fulfillment status." },
      { status: 500 },
    );
  }
}
