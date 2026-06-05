/**
 * POST /api/webhooks/etsy-orders
 *
 * Room 2 entry point: Etsy order webhook → order_queue → personalization → Printify.
 *
 * Live Etsy receipts: `receipt_id`, buyer/shipping fields, `transactions[]` with
 * `listing_id` and variation personalization (photo URL, style). Event wrappers
 * (`data`, `receipt`) are normalized in order-types.
 *
 * HMAC-SHA256 via `x-etsy-signature` when ETSY_WEBHOOK_SECRET is set; mock payloads
 * accepted without verification for local dev.
 */
export const maxDuration = 60;

import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { EtsyOrderWebhookPayload } from "@/lib/ajax/pod/order-types";
import {
  OrderProcessorError,
  insertOrderFromWebhook,
  resolveOperatorUserId,
  scheduleOrderProcessing,
} from "@/lib/ajax/pod/order-processor";
import { createServiceClient } from "@/lib/supabase/server";

function verifyEtsyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader?.trim()) return false;

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const incoming = signatureHeader.replace(/^sha256=/i, "").trim();

  const expectedBuffer = Buffer.from(expected, "hex");
  const incomingBuffer = Buffer.from(incoming, "hex");

  if (expectedBuffer.length !== incomingBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, incomingBuffer);
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  let payload: EtsyOrderWebhookPayload;

  try {
    payload = JSON.parse(rawBody) as EtsyOrderWebhookPayload;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON payload." },
      { status: 400 },
    );
  }

  const webhookSecret = process.env.ETSY_WEBHOOK_SECRET?.trim();
  if (webhookSecret) {
    const signature =
      req.headers.get("x-etsy-signature") ??
      req.headers.get("x-etsy-webhook-signature");
    if (!verifyEtsyWebhookSignature(rawBody, signature, webhookSecret)) {
      return NextResponse.json(
        { ok: false, error: "Invalid webhook signature." },
        { status: 401 },
      );
    }
  }

  try {
    const supabase = createServiceClient();
    const userId = await resolveOperatorUserId(supabase);

    const { orderId, duplicate } = await insertOrderFromWebhook(
      supabase,
      userId,
      payload,
    );

    if (!duplicate) {
      scheduleOrderProcessing(supabase, userId, orderId);
    }

    return NextResponse.json({
      ok: true,
      orderId,
      duplicate: duplicate ?? false,
      message: duplicate
        ? "Order already queued — skipped duplicate webhook."
        : "Order queued for personalization.",
    });
  } catch (err) {
    if (err instanceof OrderProcessorError) {
      return NextResponse.json(
        { ok: false, error: err.message },
        { status: err.httpStatus },
      );
    }

    console.error("[webhooks/etsy-orders] unexpected error", err);
    return NextResponse.json(
      { ok: false, error: "Unexpected error processing Etsy order webhook." },
      { status: 500 },
    );
  }
}
