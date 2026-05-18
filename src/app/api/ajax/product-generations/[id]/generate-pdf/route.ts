export const maxDuration = 60;

import { NextResponse } from "next/server";
import {
  GenerationPdfError,
  runGenerationPdfJob,
} from "@/lib/product/generation-pdf-runner";
import { buildProductPdfDownloadHref } from "@/lib/review/display";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * POST /api/ajax/product-generations/:id/generate-pdf
 * Server-only PDF generation for a stored Forge structure (decoupled from run-cycle).
 */
export async function POST(_request: Request, context: RouteContext) {
  const { id: generationId } = await context.params;

  try {
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
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const result = await runGenerationPdfJob(supabase, user.id, generationId);

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: result.error,
          generationId,
          status: "failed" as const,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      generationId,
      status: "ready" as const,
      storagePath: result.storagePath,
      downloadPath: buildProductPdfDownloadHref(generationId),
      alreadyReady: result.alreadyReady ?? false,
    });
  } catch (err) {
    if (err instanceof GenerationPdfError) {
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message, generationId },
        { status: err.httpStatus },
      );
    }

    console.error("[generate-pdf]", err);
    return NextResponse.json(
      { ok: false, error: "Failed to generate product PDF." },
      { status: 500 },
    );
  }
}
