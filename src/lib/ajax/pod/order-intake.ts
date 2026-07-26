/**
 * Personalization order intake — Room 2's real-world entry point.
 *
 * Etsy has NO order webhooks, so the webhook route alone left the
 * Personalization Bay unreachable. This poller (run from the hourly
 * autopilot) scans recent receipts for buyer personalization and feeds the
 * existing queue: receipt → order_queue → personalization agent → one-off
 * Printify fulfillment.
 *
 * Two personalization modes, mapped onto the existing photo pipeline:
 *  - PHOTO: the buyer pasted a shareable image link → that photo is the
 *    portrait base.
 *  - NAME-ONLY: the buyer typed a pet name/date → the listing's own artwork
 *    (from its Printify product) is the base, and the agent integrates the
 *    name into the design via image edit.
 *
 * Fixed (non-personalized) orders are ignored — Printify fulfills those
 * natively.
 */
import type { createEtsyAdapter } from "@/lib/ajax/adapters/etsy";
import type { PrintifyAdapter } from "@/lib/ajax/adapters/printify";
import {
  insertOrderFromWebhook,
  scheduleOrderProcessing,
} from "@/lib/ajax/pod/order-processor";
import type { EtsyOrderWebhookPayload } from "@/lib/ajax/pod/order-types";
import type { Json } from "@/lib/supabase/database.types";
import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";

/** How far back each poll looks. Overlapping windows are fine — the queue dedupes by receipt id. */
const LOOKBACK_HOURS = 26;

const URL_RE = /https?:\/\/[^\s"'<>]+/i;

export type OrderIntakeSummary = {
  scanned: number;
  personalized: number;
  queued: number;
  errors: string[];
};

/** Pull the buyer's personalization text from a transaction's variations. */
export function personalizationTextFromVariations(
  variations: { formatted_name?: string; formatted_value?: string }[],
): string | null {
  for (const v of variations) {
    if (/personal/i.test(v.formatted_name ?? "") && v.formatted_value?.trim()) {
      return v.formatted_value.trim();
    }
  }
  return null;
}

/** Split personalization text into an optional photo URL + the remaining name/date text. */
export function parsePersonalization(text: string): {
  photoUrl: string | null;
  nameText: string | null;
} {
  const match = text.match(URL_RE);
  const photoUrl = match ? match[0] : null;
  const nameText =
    text
      .replace(URL_RE, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 64) || null;
  return { photoUrl, nameText };
}

export async function pollPersonalizedOrders(
  supabase: Supabase,
  userId: string,
  deps: {
    etsy: ReturnType<typeof createEtsyAdapter>;
    printify: PrintifyAdapter;
    shopId: string;
    accessToken: string;
  },
): Promise<OrderIntakeSummary> {
  const summary: OrderIntakeSummary = {
    scanned: 0,
    personalized: 0,
    queued: 0,
    errors: [],
  };

  const minCreated = Math.floor(Date.now() / 1000) - LOOKBACK_HOURS * 3600;
  const receipts = await deps.etsy.getShopReceiptsRaw(
    deps.shopId,
    deps.accessToken,
    minCreated,
  );
  summary.scanned = receipts.length;

  // Cache Etsy-listing → base-artwork lookups across receipts in this poll.
  const artworkByListing = new Map<string, string | null>();
  const baseArtworkFor = async (etsyListingId: string): Promise<string | null> => {
    if (artworkByListing.has(etsyListingId)) {
      return artworkByListing.get(etsyListingId) ?? null;
    }
    let src: string | null = null;
    try {
      const products = await deps.printify.listProducts(50);
      for (const p of products.data) {
        const detail = await deps.printify.getProduct(p.productId);
        if (detail.data.externalId === etsyListingId) {
          src =
            detail.data.images.find((i) => i.is_default)?.src ??
            detail.data.images[0]?.src ??
            null;
          break;
        }
      }
    } catch {
      src = null;
    }
    artworkByListing.set(etsyListingId, src);
    return src;
  };

  for (const receipt of receipts) {
    try {
      // A receipt is interesting only when some transaction carries
      // personalization.
      const perTx = receipt.transactions.map((tx) => ({
        tx,
        text: personalizationTextFromVariations(tx.variations),
      }));
      const personalized = perTx.filter((p) => p.text);
      if (personalized.length === 0) continue;

      // EVERY personalized line item gets its own order row (2026-07-25
      // audit, H5). Taking only personalized[0] silently dropped the mug for
      // "Rocky" when the buyer also ordered one for "Luna" in the same
      // checkout — the receipt-keyed dedupe then blocked it forever, while
      // the per-receipt counter made the summary look complete.
      summary.personalized += personalized.length;

      for (const item of personalized) {
        const { photoUrl, nameText } = parsePersonalization(item.text!);

        let baseImageUrl = photoUrl;
        let style: string;
        if (photoUrl) {
          style = nameText
            ? `${nameText} — soft, warm pet-portrait illustration`
            : "soft, warm pet-portrait illustration";
        } else {
          // NAME-ONLY: the base is the listing's own artwork (via its Printify
          // product's default mockup/artwork), and the edit integrates the name.
          if (item.tx.listingId) {
            baseImageUrl = await baseArtworkFor(item.tx.listingId);
          }
          style = `hand-lettered addition of the pet name "${nameText ?? ""}" integrated elegantly into the existing design, keeping the artwork otherwise identical`;
        }

        if (!baseImageUrl) {
          summary.errors.push(
            `receipt ${receipt.receiptId}${item.tx.transactionId ? ` item ${item.tx.transactionId}` : ""}: personalization found but no usable base image — needs operator attention`,
          );
          await supabase.from(TABLES.EVENTS).insert({
            user_id: userId,
            event_type: "personalized_order_needs_attention",
            message: `Personalized order ${receipt.receiptId} ("${(item.text ?? "").slice(0, 60)}") could not be auto-processed — open it in Etsy and handle manually.`,
            agent_slug: "forge",
            room: "personalization_bay",
            metadata: {
              receiptId: receipt.receiptId,
              transactionId: item.tx.transactionId,
            } as Json,
          });
          continue;
        }

        const payload: EtsyOrderWebhookPayload = {
          receipt_id: receipt.receiptId,
          ...receipt.shipping,
          transactions: [
            {
              transaction_id: item.tx.transactionId ?? undefined,
              listing_id: item.tx.listingId ?? undefined,
              quantity: item.tx.quantity,
              // Size/Color choices ride along so fulfillment can pick the
              // buyer's actual variant (H6) — the personalization text was
              // already parsed out above.
              variations: item.tx.variations,
              personalization: { photo_url: baseImageUrl, style },
            },
          ],
        } as EtsyOrderWebhookPayload;

        const { orderId, duplicate } = await insertOrderFromWebhook(
          supabase,
          userId,
          payload,
        );
        if (!duplicate) {
          summary.queued += 1;
          scheduleOrderProcessing(supabase, userId, orderId);
          await supabase.from(TABLES.EVENTS).insert({
            user_id: userId,
            event_type: "personalized_order_queued",
            message: `Personalized order ${receipt.receiptId}${personalized.length > 1 ? ` (item ${item.tx.transactionId ?? "?"} of ${personalized.length})` : ""} queued (${photoUrl ? "photo portrait" : `name: "${nameText ?? ""}"`}) — Room 2 is processing it.`,
            agent_slug: "forge",
            room: "personalization_bay",
            metadata: {
              receiptId: receipt.receiptId,
              transactionId: item.tx.transactionId,
              orderId,
            } as Json,
          });
        }
      }
    } catch (err) {
      summary.errors.push(
        `receipt ${receipt.receiptId}: ${err instanceof Error ? err.message : "failed"}`,
      );
    }
  }

  return summary;
}
