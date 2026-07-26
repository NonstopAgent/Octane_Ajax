/**
 * Room 2 — Order queue orchestration: webhook insert → state transitions → factory events.
 */
import { after } from "next/server";
import { AGENT_SLUGS } from "@/lib/ajax/constants";
import {
  PersonalizationAgentError,
  runPersonalizationAgent,
} from "@/lib/ajax/pod/personalization-agent";
import {
  OrderFulfillmentError,
  resolveListingPodContext,
  runOrderProductionFulfillment,
} from "@/lib/ajax/pod/order-fulfillment";
import {
  type EtsyOrderWebhookPayload,
  type OrderQueueRow,
  type OrderQueueStatus,
  ORDER_ROOM_SLUG,
  assertOrderStatusTransition,
  demoShippingForOrder,
  extractPersonalizationFromWebhook,
  extractShippingFromWebhook,
  isValidCustomerPhotoUrl,
  sanitizeStylePrompt,
} from "@/lib/ajax/pod/order-types";
import type { Json } from "@/lib/supabase/database.types";
import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";

export class OrderProcessorError extends Error {
  readonly code = "ORDER_PROCESSOR_ERROR" as const;

  constructor(
    message: string,
    readonly httpStatus: 400 | 404 | 409 | 500 = 500,
  ) {
    super(message);
    this.name = "OrderProcessorError";
  }
}

type OrderQueueInsert = {
  user_id: string;
  etsy_order_id: string;
  /** '' when the payload carries no per-line transaction id (legacy behaviour). */
  transaction_id: string;
  listing_id?: string | null;
  customer_photo_url: string;
  style_prompt: string;
  status?: OrderQueueStatus;
  metadata?: Json;
};

async function insertFactoryEvent(
  supabase: Supabase,
  userId: string,
  payload: {
    event_type: string;
    message: string;
    metadata?: Json;
  },
) {
  const { error } = await supabase.from(TABLES.EVENTS).insert({
    user_id: userId,
    event_type: payload.event_type,
    message: payload.message,
    agent_slug: AGENT_SLUGS.FORGE,
    room: ORDER_ROOM_SLUG,
    metadata: payload.metadata ?? {},
  });

  if (error) {
    console.error("[order-processor] failed to log factory event", error);
  }
}

export async function resolveOperatorUserId(
  supabase: Supabase,
): Promise<string> {
  const operatorEmail = process.env.OPERATOR_EMAIL?.trim();
  if (!operatorEmail) {
    throw new OrderProcessorError(
      "OPERATOR_EMAIL env var not set — required for Etsy order webhooks.",
      500,
    );
  }

  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) {
    throw new OrderProcessorError(
      `Failed to resolve operator user: ${error.message}`,
      500,
    );
  }

  const operator = data.users.find(
    (u) => u.email?.toLowerCase() === operatorEmail.toLowerCase(),
  );

  if (!operator) {
    throw new OrderProcessorError(
      `No user found with email ${operatorEmail}. Sign up first.`,
      404,
    );
  }

  return operator.id;
}

async function resolveInternalListingId(
  supabase: Supabase,
  userId: string,
  etsyListingId: string | null,
): Promise<string | null> {
  if (!etsyListingId?.trim()) return null;

  const listingId = etsyListingId.trim();
  const { data, error } = await supabase
    .from(TABLES.LISTINGS)
    .select("id")
    .eq("user_id", userId)
    .or(
      `gumroad_product_id.eq.${listingId},external_listing_id.eq.${listingId}`,
    )
    .maybeSingle();

  if (error) {
    console.error("[order-processor] listing lookup failed", error);
    return null;
  }

  return data?.id ?? null;
}

function mapOrderRow(row: Record<string, unknown>): OrderQueueRow {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    etsy_order_id: String(row.etsy_order_id),
    transaction_id: row.transaction_id != null ? String(row.transaction_id) : "",
    listing_id: row.listing_id != null ? String(row.listing_id) : null,
    customer_photo_url: String(row.customer_photo_url),
    style_prompt: String(row.style_prompt),
    status: row.status as OrderQueueStatus,
    printify_product_id:
      row.printify_product_id != null ? String(row.printify_product_id) : null,
    printify_upload_id:
      row.printify_upload_id != null ? String(row.printify_upload_id) : null,
    artwork_url: row.artwork_url != null ? String(row.artwork_url) : null,
    error_message: row.error_message != null ? String(row.error_message) : null,
    metadata:
      typeof row.metadata === "object" && row.metadata !== null
        ? (row.metadata as Record<string, unknown>)
        : {},
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export async function insertOrderFromWebhook(
  supabase: Supabase,
  userId: string,
  payload: EtsyOrderWebhookPayload,
): Promise<{ orderId: string; duplicate?: boolean }> {
  const extracted = extractPersonalizationFromWebhook(payload);

  if (!extracted.etsyOrderId) {
    throw new OrderProcessorError("Missing Etsy order / receipt ID.", 400);
  }

  if (!extracted.customerPhotoUrl || !isValidCustomerPhotoUrl(extracted.customerPhotoUrl)) {
    throw new OrderProcessorError(
      "Missing or invalid customer photo URL in order personalization.",
      400,
    );
  }

  if (!extracted.rawStyle?.trim()) {
    throw new OrderProcessorError(
      "Missing style preference in order personalization.",
      400,
    );
  }

  const sanitized = sanitizeStylePrompt(extracted.rawStyle);
  if (!sanitized.ok) {
    throw new OrderProcessorError(sanitized.reason, 400);
  }

  const internalListingId = await resolveInternalListingId(
    supabase,
    userId,
    extracted.listingId,
  );

  // NEVER fabricate an address in production (2026-07-24 audit): a payload
  // missing shipping used to fall back to "123 Demo Street" — and a real,
  // billable product would ship there. Missing shipping now parks the order
  // for operator attention instead.
  const extractedShipping = extractShippingFromWebhook(payload);
  if (!extractedShipping && process.env.NODE_ENV === "production") {
    throw new OrderProcessorError(
      `Order ${extracted.etsyOrderId} arrived without a shipping address — parked for review instead of shipping to a placeholder.`,
      400,
    );
  }
  const shipping =
    extractedShipping ?? demoShippingForOrder(extracted.etsyOrderId);

  const listingContext = internalListingId
    ? await resolveListingPodContext(supabase, userId, extracted.listingId)
    : null;

  // One row PER LINE ITEM (2026-07-25 audit, H5): dedupe used to key on the
  // receipt id alone, so a two-item personalized cart produced one row and
  // the second item could NEVER be queued — every later pass hit the unique
  // constraint and reported "duplicate". The unique key is now
  // (user_id, etsy_order_id, transaction_id), '' when no per-line id exists.
  const transactionId = extracted.transactionId ?? "";

  const insert: OrderQueueInsert = {
    user_id: userId,
    etsy_order_id: extracted.etsyOrderId,
    transaction_id: transactionId,
    listing_id: internalListingId,
    customer_photo_url: extracted.customerPhotoUrl,
    style_prompt: sanitized.prompt,
    status: "pending_personalization",
    metadata: {
      rawStyle: extracted.rawStyle,
      stylePreset: sanitized.preset,
      webhookSource: "etsy",
      etsyListingId: extracted.listingId,
      etsyTransactionId: extracted.transactionId,
      quantity: extracted.quantity,
      buyerVariations: extracted.buyerVariations,
      etsyShipping: shipping,
      podDetails: listingContext?.podDetails ?? null,
    } as Json,
  };

  const { data, error } = await supabase
    .from(TABLES.ORDER_QUEUE)
    .insert(insert)
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      const { data: existing } = await supabase
        .from(TABLES.ORDER_QUEUE)
        .select("id")
        .eq("user_id", userId)
        .eq("etsy_order_id", extracted.etsyOrderId)
        .eq("transaction_id", transactionId)
        .maybeSingle();

      if (existing?.id) {
        return { orderId: existing.id, duplicate: true };
      }
    }
    throw new OrderProcessorError(
      `Failed to insert order queue row: ${error.message}`,
      500,
    );
  }

  await insertFactoryEvent(supabase, userId, {
    event_type: "order_webhook_received",
    message: `Etsy order ${extracted.etsyOrderId}${transactionId ? ` (item ${transactionId})` : ""} queued for personalization.`,
    metadata: {
      orderId: data.id,
      etsyOrderId: extracted.etsyOrderId,
      transactionId: extracted.transactionId,
      listingId: extracted.listingId,
    },
  });

  return { orderId: data.id };
}

async function updateOrderStatus(
  supabase: Supabase,
  userId: string,
  orderId: string,
  fromStatus: OrderQueueStatus,
  patch: {
    status: OrderQueueStatus;
    artwork_url?: string | null;
    printify_upload_id?: string | null;
    printify_product_id?: string | null;
    error_message?: string | null;
    style_prompt?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<OrderQueueRow> {
  assertOrderStatusTransition(fromStatus, patch.status);

  const { data: current, error: loadError } = await supabase
    .from(TABLES.ORDER_QUEUE)
    .select("*")
    .eq("id", orderId)
    .eq("user_id", userId)
    .maybeSingle();

  if (loadError || !current) {
    throw new OrderProcessorError("Order queue row not found.", 404);
  }

  const currentRow = mapOrderRow(current as Record<string, unknown>);
  if (currentRow.status !== fromStatus) {
    throw new OrderProcessorError(
      `Order ${orderId} is ${currentRow.status}, expected ${fromStatus}.`,
      409,
    );
  }

  const mergedMetadata = {
    ...currentRow.metadata,
    ...(patch.metadata ?? {}),
  };

  const { data: updated, error: updateError } = await supabase
    .from(TABLES.ORDER_QUEUE)
    .update({
      status: patch.status,
      artwork_url: patch.artwork_url ?? currentRow.artwork_url,
      printify_upload_id: patch.printify_upload_id ?? currentRow.printify_upload_id,
      printify_product_id:
        patch.printify_product_id ?? currentRow.printify_product_id,
      error_message: patch.error_message ?? null,
      style_prompt: patch.style_prompt ?? currentRow.style_prompt,
      metadata: mergedMetadata as Json,
    })
    .eq("id", orderId)
    .eq("user_id", userId)
    .select("*")
    .single();

  if (updateError || !updated) {
    throw new OrderProcessorError("Failed to update order queue row.", 500);
  }

  return mapOrderRow(updated as Record<string, unknown>);
}

export type OrderProcessResult =
  | { ok: true; order: OrderQueueRow; alreadyReady?: boolean }
  | { ok: false; error: string; step?: string; order?: OrderQueueRow };

/**
 * Runs the full personalization pipeline for one order_queue row.
 */
export async function processOrderQueueEntry(
  supabase: Supabase,
  userId: string,
  orderId: string,
): Promise<OrderProcessResult> {
  const { data: row, error: loadError } = await supabase
    .from(TABLES.ORDER_QUEUE)
    .select("*")
    .eq("id", orderId)
    .eq("user_id", userId)
    .maybeSingle();

  if (loadError) {
    throw new OrderProcessorError("Failed to load order queue row.", 500);
  }

  if (!row) {
    throw new OrderProcessorError("Order queue row not found.", 404);
  }

  const order = mapOrderRow(row as Record<string, unknown>);

  if (order.status === "production_submitted") {
    return { ok: true, order, alreadyReady: true };
  }

  if (order.status === "fulfillment_ready") {
    return submitProductionForOrder(supabase, userId, orderId, order);
  }

  if (order.status === "failed") {
    return { ok: false, error: order.error_message ?? "Order previously failed." };
  }

  if (order.status === "processing_artwork") {
    return {
      ok: false,
      error: "Personalization is already in progress.",
      step: "processing",
    };
  }

  await updateOrderStatus(supabase, userId, orderId, "pending_personalization", {
    status: "processing_artwork",
  });

  await insertFactoryEvent(supabase, userId, {
    event_type: "order_personalization_started",
    message: `Personalizing artwork for Etsy order ${order.etsy_order_id}.`,
    metadata: { orderId, etsyOrderId: order.etsy_order_id },
  });

  try {
    const result = await runPersonalizationAgent(order);

    const fulfilled = await updateOrderStatus(
      supabase,
      userId,
      orderId,
      "processing_artwork",
      {
        status: "fulfillment_ready",
        artwork_url: result.artworkUrl,
        printify_upload_id: result.printifyUploadId,
        style_prompt: result.sanitizedStylePrompt,
        metadata: {
          adapterModes: result.adapterModes,
          fulfilledAt: new Date().toISOString(),
        },
      },
    );

    await insertFactoryEvent(supabase, userId, {
      event_type: "order_fulfillment_ready",
      message: `Printify artwork uploaded for Etsy order ${order.etsy_order_id}.`,
      metadata: {
        orderId,
        etsyOrderId: order.etsy_order_id,
        printifyUploadId: result.printifyUploadId,
        adapterModes: result.adapterModes,
      },
    });

    return submitProductionForOrder(supabase, userId, orderId, fulfilled);
  } catch (err) {
    const message =
      err instanceof PersonalizationAgentError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Personalization failed.";

    const failed = await updateOrderStatus(
      supabase,
      userId,
      orderId,
      "processing_artwork",
      {
        status: "failed",
        error_message: message,
        metadata: {
          failedAt: new Date().toISOString(),
          step: err instanceof PersonalizationAgentError ? err.step : undefined,
        },
      },
    );

    await insertFactoryEvent(supabase, userId, {
      event_type: "order_personalization_failed",
      message: `Personalization failed for Etsy order ${order.etsy_order_id} — manual review required.`,
      metadata: {
        orderId,
        etsyOrderId: order.etsy_order_id,
        error: message,
        step: err instanceof PersonalizationAgentError ? err.step : undefined,
      },
    });

    return {
      ok: false,
      error: message,
      step: err instanceof PersonalizationAgentError ? err.step : undefined,
      order: failed,
    };
  }
}

async function submitProductionForOrder(
  supabase: Supabase,
  userId: string,
  orderId: string,
  order: OrderQueueRow,
): Promise<OrderProcessResult> {
  const listingContext = order.listing_id
    ? await resolveListingPodContext(
        supabase,
        userId,
        typeof order.metadata.etsyListingId === "string"
          ? order.metadata.etsyListingId
          : null,
      )
    : typeof order.metadata.etsyListingId === "string"
      ? await resolveListingPodContext(
          supabase,
          userId,
          order.metadata.etsyListingId,
        )
      : null;

  await insertFactoryEvent(supabase, userId, {
    event_type: "order_production_started",
    message: `Submitting Printify production for Etsy order ${order.etsy_order_id}.`,
    metadata: { orderId, etsyOrderId: order.etsy_order_id },
  });

  try {
    const production = await runOrderProductionFulfillment(
      supabase,
      userId,
      {
        order,
        listingContext,
        quantity:
          typeof order.metadata.quantity === "number"
            ? order.metadata.quantity
            : 1,
      },
    );

    const submitted = await updateOrderStatus(
      supabase,
      userId,
      orderId,
      "fulfillment_ready",
      {
        status: "production_submitted",
        printify_product_id: production.printifyProductId,
        metadata: {
          printifyOrderId: production.printifyOrderId,
          productionSubmittedAt: new Date().toISOString(),
          productionAdapterModes: production.adapterModes,
          productionVariantId: production.variantId,
          productionVariantMatch: production.variantMatch,
          productionQuantity: production.quantity,
        },
      },
    );

    if (production.variantWarning) {
      await insertFactoryEvent(supabase, userId, {
        event_type: "order_variant_needs_attention",
        message: `Etsy order ${order.etsy_order_id}: ${production.variantWarning}`,
        metadata: {
          orderId,
          etsyOrderId: order.etsy_order_id,
          printifyOrderId: production.printifyOrderId,
          variantId: production.variantId,
        },
      });
    }

    await insertFactoryEvent(supabase, userId, {
      event_type: "order_production_submitted",
      message: `Printify production submitted for Etsy order ${order.etsy_order_id}.`,
      metadata: {
        orderId,
        etsyOrderId: order.etsy_order_id,
        printifyProductId: production.printifyProductId,
        printifyOrderId: production.printifyOrderId,
        adapterModes: production.adapterModes,
      },
    });

    return { ok: true, order: submitted };
  } catch (err) {
    const message =
      err instanceof OrderFulfillmentError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Printify production submission failed.";

    const failed = await updateOrderStatus(
      supabase,
      userId,
      orderId,
      "fulfillment_ready",
      {
        status: "failed",
        error_message: message,
        metadata: {
          failedAt: new Date().toISOString(),
          step:
            err instanceof OrderFulfillmentError ? err.step : "production",
        },
      },
    );

    await insertFactoryEvent(supabase, userId, {
      event_type: "order_production_failed",
      message: `Printify production failed for Etsy order ${order.etsy_order_id} — manual review required.`,
      metadata: {
        orderId,
        etsyOrderId: order.etsy_order_id,
        error: message,
        step: err instanceof OrderFulfillmentError ? err.step : "production",
      },
    });

    return {
      ok: false,
      error: message,
      step: err instanceof OrderFulfillmentError ? err.step : "production",
      order: failed,
    };
  }
}

/**
 * Detached order processing after webhook / intake capture.
 *
 * Uses Next's `after()` so the 60–240s personalization survives on Vercel
 * serverless once the response is sent — this was the LAST plain
 * fire-and-forget in the repo, on the one path where a buyer had already
 * paid: the lambda froze mid-`await`, the row sat in `processing_artwork`
 * forever, and the dedupe made sure it was never retried (2026-07-25 audit,
 * H4; same fix generation-pod-runner.ts applied everywhere else). Falls back
 * to a detached promise outside a request scope (tests, scripts), and
 * `reclaimStaleOrders` is the backstop when even `after()` is cut short by
 * the function's time budget.
 */
export function scheduleOrderProcessing(
  supabase: Supabase,
  userId: string,
  orderId: string,
): void {
  const job = async () => {
    try {
      const result = await processOrderQueueEntry(supabase, userId, orderId);
      if (!result.ok) {
        console.error("[order-processor] async processing failed", result.error);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Order processing failed.";
      console.error("[order-processor] async processing error", message);
      await insertFactoryEvent(supabase, userId, {
        event_type: "order_processing_error",
        message: "Unexpected error during order personalization.",
        metadata: { orderId, error: message },
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

/** Non-terminal orders older than this are surfaced to the operator. */
const STALLED_ORDER_ALERT_MINUTES = 60;

export type StaleOrderReclaimResult = {
  /** Orders reset from a stuck `processing_artwork` back to the queue. */
  reclaimed: { orderId: string; etsyOrderId: string; stuckMinutes: number }[];
  /** Any non-terminal order older than the alert window (visibility only). */
  stalled: { orderId: string; etsyOrderId: string; status: OrderQueueStatus; ageMinutes: number }[];
};

/**
 * Backstop for H4: a personalization that died mid-flight (frozen lambda,
 * crash, deploy) leaves `processing_artwork` behind with no owner. Nothing
 * anywhere reset those rows, so a PAID order could silently never ship.
 *
 * Resets stuck `processing_artwork` rows to `pending_personalization` (the
 * caller decides whether to reprocess immediately) and reports every
 * non-terminal order older than an hour so the autopilot pass can surface it
 * instead of logging "shop is healthy".
 *
 * The reset is claim-safe: the UPDATE re-checks status AND staleness, so a
 * personalization that legitimately finished (or another reclaimer) in the
 * meantime wins and the row is skipped.
 */
export async function reclaimStaleOrders(
  supabase: Supabase,
  userId: string,
  opts: { staleMinutes?: number; limit?: number } = {},
): Promise<StaleOrderReclaimResult> {
  // Worst-case legitimate personalization ≈ 4 min image edit + uploads;
  // 20 min means a healthy run is never stolen, a dead one loses ≤1 cycle.
  const staleMinutes = opts.staleMinutes ?? 20;
  const limit = opts.limit ?? 5;
  const now = Date.now();
  const staleCutoff = new Date(now - staleMinutes * 60_000).toISOString();
  const alertCutoff = new Date(
    now - STALLED_ORDER_ALERT_MINUTES * 60_000,
  ).toISOString();

  const result: StaleOrderReclaimResult = { reclaimed: [], stalled: [] };

  const { data: nonTerminal, error } = await supabase
    .from(TABLES.ORDER_QUEUE)
    .select("id, etsy_order_id, status, updated_at")
    .eq("user_id", userId)
    .in("status", [
      "pending_personalization",
      "processing_artwork",
      "fulfillment_ready",
    ])
    .lt("updated_at", staleCutoff)
    .order("updated_at", { ascending: true })
    .limit(50);

  if (error) {
    throw new OrderProcessorError(
      `Failed to scan order queue for stale orders: ${error.message}`,
      500,
    );
  }

  for (const row of nonTerminal ?? []) {
    const status = row.status as OrderQueueStatus;
    const updatedAtMs = new Date(String(row.updated_at)).getTime();
    const ageMinutes = Math.round((now - updatedAtMs) / 60_000);

    if (status === "processing_artwork" && result.reclaimed.length < limit) {
      const { data: claimed, error: claimError } = await supabase
        .from(TABLES.ORDER_QUEUE)
        .update({
          status: "pending_personalization",
          error_message: `Reclaimed after ${ageMinutes} min stuck in processing_artwork.`,
        })
        .eq("id", row.id)
        .eq("user_id", userId)
        .eq("status", "processing_artwork")
        .lt("updated_at", staleCutoff)
        .select("id");

      if (!claimError && (claimed?.length ?? 0) > 0) {
        result.reclaimed.push({
          orderId: String(row.id),
          etsyOrderId: String(row.etsy_order_id),
          stuckMinutes: ageMinutes,
        });
        await insertFactoryEvent(supabase, userId, {
          event_type: "order_processing_reclaimed",
          message: `Etsy order ${row.etsy_order_id} was stuck in personalization for ${ageMinutes} min — re-queued for retry.`,
          metadata: { orderId: row.id, etsyOrderId: row.etsy_order_id, stuckMinutes: ageMinutes },
        });
        continue;
      }
    }

    if (String(row.updated_at) < alertCutoff) {
      result.stalled.push({
        orderId: String(row.id),
        etsyOrderId: String(row.etsy_order_id),
        status,
        ageMinutes,
      });
    }
  }

  return result;
}
