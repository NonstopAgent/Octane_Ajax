export const maxDuration = 60;

import { NextResponse } from "next/server";
import { AGENT_SLUGS, ROOM_SLUGS } from "@/lib/ajax/constants";
import {
  GenerationPdfError,
  runGenerationPdfJob,
} from "@/lib/product/generation-pdf-runner";
import { mapGenerationFromDb } from "@/lib/product/mappers";
import { buildProductPdfDownloadHref } from "@/lib/review/display";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { TABLES } from "@/lib/supabase/schema";

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

    const { data: genRow, error: genLoadError } = await supabase
      .from(TABLES.GENERATIONS)
      .select("*")
      .eq("id", generationId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!genLoadError && genRow) {
      const generation = mapGenerationFromDb(genRow);
      const listingId = generation.productListingId;
      const { podDetails } = generation;
      const format = podDetails.aestheticStyle;
      const blueprintId = podDetails.blueprintId;

      const { data: listingRow } = await supabase
        .from(TABLES.LISTINGS)
        .select("title")
        .eq("id", listingId ?? "")
        .eq("user_id", user.id)
        .maybeSingle();

      const { data: ideaRow } = await supabase
        .from(TABLES.IDEAS)
        .select("niche")
        .eq("id", generation.productIdeaId)
        .eq("user_id", user.id)
        .maybeSingle();

      const listingTitle = listingRow?.title?.trim() || "Untitled product";
      const niche = ideaRow?.niche?.trim() || undefined;

      const mockupMetadata: Json = {
        generationId,
        listingId: listingId ?? null,
        listingTitle,
        niche: niche ?? null,
        format,
        blueprintId,
      };

      if (generation.fulfillment?.artworkUrl) {
        await supabase.from(TABLES.EVENTS).insert({
          user_id: user.id,
          event_type: "mockup_ready",
          message: "POD artwork ready for review.",
          agent_slug: AGENT_SLUGS.FORGE,
          room: ROOM_SLUGS.DESIGN_PRESS,
          metadata: {
            ...mockupMetadata,
            artworkUrl: generation.fulfillment.artworkUrl,
          } as Json,
        });
      } else {
        await supabase.from(TABLES.EVENTS).insert({
          user_id: user.id,
          event_type: "mockup_generation_failed",
          message:
            "Artwork not ready — listing can still be reviewed after POD fulfillment completes.",
          agent_slug: AGENT_SLUGS.FORGE,
          room: ROOM_SLUGS.DESIGN_PRESS,
          metadata: mockupMetadata,
        });
      }
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
