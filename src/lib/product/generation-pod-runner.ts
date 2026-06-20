/**
 * Server-only: load a stored generation and run POD fulfillment + factory events.
 */
import { after } from "next/server";
import { AGENT_SLUGS, ROOM_SLUGS } from "@/lib/ajax/constants";
import {
  PodFulfillmentError,
  runPodFulfillment,
  type PodFulfillmentJobResult,
} from "@/lib/ajax/pod/fulfillment-runner";
import { mapGenerationFromDb, mapGenerationToDbUpdate } from "@/lib/product/mappers";
import { uploadPublicArtwork } from "@/lib/product/pdf-storage";
import type { Json } from "@/lib/supabase/database.types";
import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";

export class GenerationPodError extends Error {
  readonly code = "GENERATION_POD_ERROR" as const;

  constructor(
    message: string,
    readonly httpStatus: 404 | 409 | 500 = 500,
  ) {
    super(message);
    this.name = "GenerationPodError";
  }
}

/**
 * A `generating` row whose `updated_at` is older than this is treated as a dead
 * attempt (the serverless function was almost certainly torn down mid-call) and
 * is allowed to be retried instead of being wedged behind a 409 forever.
 */
const STALE_FULFILLMENT_MS = 90_000;

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
    console.error("[generation-pod] failed to log factory event", error);
  }
}

/**
 * Runs POD fulfillment for an existing `product_generations` row.
 * Idempotent when status is already `ready` with a Printify product ID.
 */
export async function runGenerationPodJob(
  supabase: Supabase,
  userId: string,
  generationId: string,
): Promise<PodFulfillmentJobResult> {
  const { data: row, error: loadError } = await supabase
    .from(TABLES.GENERATIONS)
    .select("*")
    .eq("id", generationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (loadError) {
    throw new GenerationPodError("Failed to load product generation.", 500);
  }

  if (!row) {
    throw new GenerationPodError("Product generation not found.", 404);
  }

  const generation = mapGenerationFromDb(row);

  if (
    generation.generationStatus === "ready" &&
    generation.fulfillment?.printifyProductId?.trim()
  ) {
    return {
      ok: true,
      fulfillment: generation.fulfillment,
      alreadyReady: true,
    };
  }

  if (generation.generationStatus === "generating") {
    const updatedAtMs = row.updated_at ? new Date(row.updated_at).getTime() : 0;
    const isStale =
      Number.isFinite(updatedAtMs) &&
      Date.now() - updatedAtMs > STALE_FULFILLMENT_MS;
    if (!isStale) {
      throw new GenerationPodError("POD fulfillment is already in progress.", 409);
    }
    // Stale `generating` row: the prior attempt died (likely a serverless
    // timeout). Fall through and re-run rather than wedging it forever.
  }

  const listingId = generation.productListingId;
  if (!listingId) {
    throw new GenerationPodError("Generation has no linked listing.", 500);
  }

  const { data: listingRow, error: listingError } = await supabase
    .from(TABLES.LISTINGS)
    .select("title, description")
    .eq("id", listingId)
    .eq("user_id", userId)
    .maybeSingle();

  if (listingError || !listingRow) {
    throw new GenerationPodError("Failed to load listing for POD fulfillment.", 500);
  }

  const { data: ideaRow, error: ideaError } = await supabase
    .from(TABLES.IDEAS)
    .select("niche, raw_payload")
    .eq("id", generation.productIdeaId)
    .eq("user_id", userId)
    .maybeSingle();

  if (ideaError) {
    throw new GenerationPodError("Failed to load product idea for POD.", 500);
  }

  const niche =
    ideaRow?.niche?.trim() ||
    (typeof ideaRow?.raw_payload === "object" &&
    ideaRow.raw_payload !== null &&
    !Array.isArray(ideaRow.raw_payload) &&
    typeof (ideaRow.raw_payload as Record<string, unknown>).niche === "string"
      ? ((ideaRow.raw_payload as Record<string, unknown>).niche as string)
      : "general");

  await supabase
    .from(TABLES.GENERATIONS)
    .update(mapGenerationToDbUpdate({ generationStatus: "generating" }))
    .eq("id", generationId)
    .eq("user_id", userId);

  try {
    const result = await runPodFulfillment({
      forgeResult: {
        listingTitle: listingRow.title?.trim() || "Untitled product",
        listingDescription: listingRow.description ?? "",
        podDetails: generation.podDetails,
        coverImagePrompt:
          typeof generation.podDetails.metadata?.coverImagePrompt === "string"
            ? generation.podDetails.metadata.coverImagePrompt
            : "",
      },
      niche,
      publish: false,
    });

    // gpt-image-1 returns base64. Persist the bytes to Storage and store a
    // stable path + a small serving URL instead of a multi-MB data: URI.
    let artworkRef = result.fulfillment.artworkUrl ?? null;
    let mockupPath: string | null = artworkRef;
    if (result.artwork?.base64) {
      try {
        const publicUrl = await uploadPublicArtwork(
          userId,
          generationId,
          Buffer.from(result.artwork.base64, "base64"),
          result.artwork.mimeType ?? "image/png",
        );
        // Store the stable public URL in both fields (small, renders everywhere).
        mockupPath = publicUrl;
        artworkRef = publicUrl;
      } catch (storageErr) {
        console.error("[generation-pod] artwork storage upload failed", storageErr);
        // Non-fatal: fall back to whatever URL the adapter returned.
      }
    }

    const fulfillmentForStore = { ...result.fulfillment, artworkUrl: artworkRef };

    const podDetailsWithFulfillment = {
      ...generation.podDetails,
      metadata: {
        ...generation.podDetails.metadata,
        fulfillment: fulfillmentForStore,
      },
    };

    await supabase
      .from(TABLES.GENERATIONS)
      .update(
        mapGenerationToDbUpdate({
          generationStatus: "ready",
          podDetails: podDetailsWithFulfillment,
          mockupStoragePath: mockupPath,
        }),
      )
      .eq("id", generationId)
      .eq("user_id", userId);

    // Surface the artwork on the listing so the Review Gate can render it.
    if (artworkRef) {
      await supabase
        .from(TABLES.LISTINGS)
        .update({ mockup_url: artworkRef })
        .eq("id", listingId)
        .eq("user_id", userId);
    }

    await insertFactoryEvent(supabase, userId, {
      event_type: "pod_fulfillment_ready",
      agent_slug: AGENT_SLUGS.FORGE,
      room: ROOM_SLUGS.DESIGN_PRESS,
      message: "Printify product draft ready for review.",
      metadata: {
        generationId,
        listingId,
        printifyProductId: result.fulfillment.printifyProductId,
        adapterMode: result.fulfillment.adapterMode,
      },
    });

    return { ok: true, fulfillment: fulfillmentForStore };
  } catch (err) {
    const message =
      err instanceof PodFulfillmentError
        ? err.message
        : err instanceof Error
          ? err.message
          : "POD fulfillment failed.";

    await supabase
      .from(TABLES.GENERATIONS)
      .update(mapGenerationToDbUpdate({ generationStatus: "failed" }))
      .eq("id", generationId)
      .eq("user_id", userId);

    await insertFactoryEvent(supabase, userId, {
      event_type: "pod_fulfillment_failed",
      agent_slug: AGENT_SLUGS.FORGE,
      room: ROOM_SLUGS.DESIGN_PRESS,
      message:
        "POD fulfillment failed — listing remains at Review Gate for human review.",
      metadata: {
        generationId,
        listingId,
        error: message,
        step: err instanceof PodFulfillmentError ? err.step : undefined,
      },
    });

    return { ok: false, error: message };
  }
}

/**
 * POD fulfillment after Forge — does not block the forge response.
 *
 * Uses Next's `after()` so the work survives on Vercel serverless after the
 * response is sent (a plain fire-and-forget promise would be frozen with the
 * lambda). Falls back to a detached promise outside a request scope (tests,
 * scripts).
 */
export function schedulePodFulfillmentAfterForge(
  supabase: Supabase,
  userId: string,
  generationId: string,
  listingId: string,
): void {
  const job = async () => {
    await insertFactoryEvent(supabase, userId, {
      event_type: "pod_fulfillment_triggered",
      agent_slug: AGENT_SLUGS.FORGE,
      room: ROOM_SLUGS.DESIGN_PRESS,
      message: "POD fulfillment auto-started after Forge.",
      metadata: { generationId, listingId },
    });

    try {
      const result = await runGenerationPodJob(supabase, userId, generationId);
      if (!result.ok) {
        await insertFactoryEvent(supabase, userId, {
          event_type: "pod_fulfillment_trigger_failed",
          agent_slug: AGENT_SLUGS.FORGE,
          room: ROOM_SLUGS.DESIGN_PRESS,
          message: "Auto POD fulfillment trigger failed after Forge.",
          metadata: {
            generationId,
            listingId,
            error: result.error,
          },
        });
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "POD auto-trigger failed.";
      await insertFactoryEvent(supabase, userId, {
        event_type: "pod_fulfillment_trigger_failed",
        agent_slug: AGENT_SLUGS.FORGE,
        room: ROOM_SLUGS.DESIGN_PRESS,
        message: "Auto POD fulfillment trigger failed after Forge.",
        metadata: {
          generationId,
          listingId,
          error: message,
        },
      });
    }
  };

  try {
    after(job);
  } catch {
    // Outside a request scope (tests, local scripts) — run detached.
    void job();
  }
}
