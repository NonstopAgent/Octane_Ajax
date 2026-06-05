/**
 * Server-only: load a stored generation and run POD fulfillment + factory events.
 */
import { AGENT_SLUGS, ROOM_SLUGS } from "@/lib/ajax/constants";
import {
  PodFulfillmentError,
  runPodFulfillment,
  type PodFulfillmentJobResult,
} from "@/lib/ajax/pod/fulfillment-runner";
import { mapGenerationFromDb, mapGenerationToDbUpdate } from "@/lib/product/mappers";
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
    throw new GenerationPodError("POD fulfillment is already in progress.", 409);
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

    const podDetailsWithFulfillment = {
      ...generation.podDetails,
      metadata: {
        ...generation.podDetails.metadata,
        fulfillment: result.fulfillment,
      },
    };

    await supabase
      .from(TABLES.GENERATIONS)
      .update(
        mapGenerationToDbUpdate({
          generationStatus: "ready",
          podDetails: podDetailsWithFulfillment,
          mockupStoragePath: result.fulfillment.artworkUrl ?? null,
        }),
      )
      .eq("id", generationId)
      .eq("user_id", userId);

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

    return { ok: true, fulfillment: result.fulfillment };
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
 * Fire-and-forget POD fulfillment after Forge — does not block the forge response.
 */
export function schedulePodFulfillmentAfterForge(
  supabase: Supabase,
  userId: string,
  generationId: string,
  listingId: string,
): void {
  void (async () => {
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
  })();
}
