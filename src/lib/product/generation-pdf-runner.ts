/**
 * Server-only: load a stored generation and run PDF generation + factory events.
 */
import { AGENT_SLUGS, ROOM_SLUGS } from "@/lib/ajax/constants";
import { mapGenerationFromDb } from "@/lib/product/mappers";
import { generateAndStoreProductPdf } from "@/lib/product/pdf-service";
import type { ProductStructure } from "@/lib/product/domain";
import type { Json } from "@/lib/supabase/database.types";
import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";

export class GenerationPdfError extends Error {
  readonly code = "GENERATION_PDF_ERROR" as const;

  constructor(
    message: string,
    readonly httpStatus: 404 | 409 | 500 = 500,
  ) {
    super(message);
    this.name = "GenerationPdfError";
  }
}

export type GenerationPdfJobResult =
  | { ok: true; storagePath: string; alreadyReady?: boolean }
  | { ok: false; error: string };

async function insertFactoryEvent(
  supabase: Supabase,
  userId: string,
  payload: {
    event_type: string;
    message: string;
    agent_slug?: string | null;
    room?: string | null;
    metadata?: Json;
  },
) {
  const { error } = await supabase.from(TABLES.EVENTS).insert({
    user_id: userId,
    event_type: payload.event_type,
    message: payload.message,
    agent_slug: payload.agent_slug ?? null,
    room: payload.room ?? null,
    metadata: payload.metadata ?? {},
  });

  if (error) {
    console.error("[generation-pdf] failed to log factory event", error);
  }
}

/**
 * Generates (or re-generates) the PDF for an existing `product_generations` row.
 * Idempotent when status is already `ready` with a storage path.
 */
export async function runGenerationPdfJob(
  supabase: Supabase,
  userId: string,
  generationId: string,
): Promise<GenerationPdfJobResult> {
  const { data: row, error: loadError } = await supabase
    .from(TABLES.GENERATIONS)
    .select("*")
    .eq("id", generationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (loadError) {
    throw new GenerationPdfError("Failed to load product generation.", 500);
  }

  if (!row) {
    throw new GenerationPdfError("Product generation not found.", 404);
  }

  const generation = mapGenerationFromDb(row);

  if (
    generation.generationStatus === "ready" &&
    generation.pdf.storagePath?.trim()
  ) {
    return {
      ok: true,
      storagePath: generation.pdf.storagePath,
      alreadyReady: true,
    };
  }

  if (generation.generationStatus === "generating") {
    throw new GenerationPdfError("PDF generation is already in progress.", 409);
  }

  const listingId = generation.productListingId;
  if (!listingId) {
    throw new GenerationPdfError("Generation has no linked listing.", 500);
  }

  const { data: listingRow, error: listingError } = await supabase
    .from(TABLES.LISTINGS)
    .select("title, description")
    .eq("id", listingId)
    .eq("user_id", userId)
    .maybeSingle();

  if (listingError || !listingRow) {
    throw new GenerationPdfError("Failed to load listing for PDF.", 500);
  }

  const { data: ideaRow, error: ideaError } = await supabase
    .from(TABLES.IDEAS)
    .select("raw_payload")
    .eq("id", generation.productIdeaId)
    .eq("user_id", userId)
    .maybeSingle();

  if (ideaError) {
    throw new GenerationPdfError("Failed to load product idea for PDF.", 500);
  }

  const rawPayload = ideaRow?.raw_payload;
  const audience =
    typeof rawPayload === "object" &&
    rawPayload !== null &&
    !Array.isArray(rawPayload) &&
    typeof (rawPayload as Record<string, unknown>).targetBuyer === "string"
      ? ((rawPayload as Record<string, unknown>).targetBuyer as string)
      : undefined;

  const aiDisclosure =
    typeof generation.podDetails.metadata?.aiDisclosure === "string"
      ? generation.podDetails.metadata.aiDisclosure
      : undefined;

  const listingTitle = listingRow.title?.trim() || "Untitled product";

  // Legacy PDF path — only for rows that still store printable page structures.
  const legacyPages = (row.structure as { pages?: unknown[] } | null)?.pages;
  if (!Array.isArray(legacyPages) || legacyPages.length === 0) {
    return {
      ok: false,
      error: "This generation is a POD product — PDF generation is not applicable.",
    };
  }

  const pdfResult = await generateAndStoreProductPdf({
    supabase,
    userId,
    generationId,
    structure: {
      format: "legacy",
      pageCount: legacyPages.length,
      pages: legacyPages as ProductStructure["pages"],
      metadata: generation.podDetails.metadata,
    },
    listingTitle,
    listingDescription: listingRow.description ?? undefined,
    footerNote: aiDisclosure,
    audience,
  });

  if (pdfResult.ok) {
    await insertFactoryEvent(supabase, userId, {
      event_type: "pdf_ready",
      agent_slug: AGENT_SLUGS.FORGE,
      room: ROOM_SLUGS.DESIGN_PRESS,
      message: "PDF ready for review download.",
      metadata: {
        generationId,
        listingId,
        storagePath: pdfResult.storagePath,
      },
    });

    return pdfResult;
  }

  await insertFactoryEvent(supabase, userId, {
    event_type: "pdf_generation_failed",
    agent_slug: AGENT_SLUGS.FORGE,
    room: ROOM_SLUGS.DESIGN_PRESS,
    message:
      "PDF generation failed — listing remains at Review Gate for human review.",
    metadata: {
      generationId,
      listingId,
      error: pdfResult.error,
    },
  });

  return pdfResult;
}

/**
 * Fire-and-forget PDF job after Forge — does not block the forge response.
 * Logs `pdf_auto_triggered` on start and `pdf_trigger_failed` if the job cannot complete.
 */
export function scheduleGenerationPdfAfterForge(
  supabase: Supabase,
  userId: string,
  generationId: string,
  listingId: string,
): void {
  void (async () => {
    await insertFactoryEvent(supabase, userId, {
      event_type: "pdf_auto_triggered",
      agent_slug: AGENT_SLUGS.FORGE,
      room: ROOM_SLUGS.DESIGN_PRESS,
      message: "PDF generation auto-started after Forge.",
      metadata: { generationId, listingId },
    });

    try {
      const result = await runGenerationPdfJob(supabase, userId, generationId);
      if (!result.ok) {
        await insertFactoryEvent(supabase, userId, {
          event_type: "pdf_trigger_failed",
          agent_slug: AGENT_SLUGS.FORGE,
          room: ROOM_SLUGS.DESIGN_PRESS,
          message: "Auto PDF trigger failed after Forge.",
          metadata: {
            generationId,
            listingId,
            error: result.error,
          },
        });
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "PDF auto-trigger failed.";
      await insertFactoryEvent(supabase, userId, {
        event_type: "pdf_trigger_failed",
        agent_slug: AGENT_SLUGS.FORGE,
        room: ROOM_SLUGS.DESIGN_PRESS,
        message: "Auto PDF trigger failed after Forge.",
        metadata: {
          generationId,
          listingId,
          error: message,
        },
      });
    }
  })();
}
