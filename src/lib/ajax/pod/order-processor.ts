/**
 * Room 2 — Order queue orchestration: webhook insert → state transitions → factory events.
 */
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

  const shipping =
    extractShippingFromWebhook(payload) ??
    demoShippingForOrder(extracted.etsyOrderId);

  const listingContext = internalListingId
    ? await resolveListingPodContext(supabase, userId, extracted.listingId)
    : null;

  const insert: OrderQueueInsert = {
    user_id: userId,
    etsy_order_id: extracted.etsyOrderId,
    listing_id: internalListingId,
    customer_photo_url: extracted.customerPhotoUrl,
    style_prompt: sanitized.prompt,
    status: "pending_personalization",
    metadata: {
      rawStyle: extracted.rawStyle,
      stylePreset: sanitized.preset,
      webhookSource: "etsy",
      etsyListingId: extracted.listingId,
      quantity: extracted.quantity,
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
    message: `Etsy order ${extracted.etsyOrderId} queued for personalization.`,
    metadata: {
      orderId: data.id,
      etsyOrderId: extracted.etsyOrderId,
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
          productionQuantity: production.quantity,
        },
      },
    );

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
 * Fire-and-forget order processing after webhook capture.
 */
export function scheduleOrderProcessing(
  supabase: Supabase,
  userId: string,
  orderId: string,
): void {
  void (async () => {
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
  })();
}
