/**
 * Publish an approved product to Etsy THROUGH Printify.
 *
 * Printify (connected to the operator's Etsy shop in Printify's own dashboard)
 * creates a complete Etsy listing — real variants, sizes, pricing, shipping, and
 * order fulfillment linkage — which the direct Etsy listing API cannot do for POD.
 * When the shop's Printify publish setting is "Publish as draft", this respects the
 * Review Gate: the human approves here, Printify creates the Etsy DRAFT, and the
 * human publishes it live from Etsy.
 *
 * Never throws — failures are logged as factory events so approval continues.
 */
import {
  createPrintifyAdapter,
  isPrintifyConfigured,
  pickMockupImages,
  MAX_PUBLISH_MOCKUPS,
  type PrintifyAdapter,
} from "@/lib/ajax/adapters/printify";
import { createEtsyAdapter } from "@/lib/ajax/adapters/etsy";
import { refreshEtsyToken } from "@/lib/ajax/etsy-auth";
import { mapListingFromDb } from "@/lib/ajax/mappers";
import type { ProductListing } from "@/lib/ajax/types";
import type { ProductGeneration } from "@/lib/product/domain";
import { insertGumroadEvent } from "@/lib/review/gumroad-on-approve";
import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";

export type PrintifyPublishContext = {
  supabase: Supabase;
  userId: string;
  listingId: string;
  listing: ProductListing;
  generation: ProductGeneration | null;
};

export type PrintifyPublishResult = {
  listing: ProductListing;
  url: string;
} | null;

/**
 * Make sure the Etsy listing carries the full mockup gallery, not just the
 * single default photo Printify syncs on publish. Uploads the missing varied
 * mockups (front + angles + lifestyle) straight to the Etsy listing via the
 * Etsy API. Idempotent (checks the current image count) and best-effort —
 * a failure never breaks the publish.
 */
async function ensureEtsyMockupGallery(
  supabase: Supabase,
  userId: string,
  listingId: string,
  printifyProductId: string,
  adapter: PrintifyAdapter,
): Promise<void> {
  try {
    const product = await adapter.getProduct(printifyProductId);
    const etsyListingId = product.data.externalId;
    if (!etsyListingId) return;

    const picks = pickMockupImages(product.data.images, MAX_PUBLISH_MOCKUPS);
    if (picks.length <= 1) return;

    const credentials = await refreshEtsyToken(userId, { supabase });
    if (!credentials) return;

    const etsy = createEtsyAdapter();
    const existing = await etsy.getListingImages(
      etsyListingId,
      credentials.access_token,
    );
    if (existing.length >= picks.length) return;

    let added = 0;
    for (let i = existing.length; i < picks.length; i += 1) {
      const src = picks[i]!.image.src;
      const res = await fetch(src);
      if (!res.ok) continue;
      const buffer = Buffer.from(await res.arrayBuffer());
      await etsy.uploadListingImage(
        etsyListingId,
        buffer,
        `mockup-${i + 1}.jpg`,
        credentials.shop_id,
        credentials.access_token,
        i + 1,
      );
      added += 1;
    }

    if (added > 0) {
      await insertGumroadEvent(
        supabase,
        userId,
        "etsy_gallery_filled",
        `Added ${added} mockup photo(s) to the Etsy listing (now ${existing.length + added} total).`,
        { listingId, printifyProductId, etsyListingId, added },
      );
    }
  } catch (err) {
    await insertGumroadEvent(
      supabase,
      userId,
      "etsy_gallery_failed",
      `Mockup gallery top-up failed: ${err instanceof Error ? err.message : "unknown"}`,
      { listingId, printifyProductId },
    );
  }
}

export async function publishListingViaPrintify(
  ctx: PrintifyPublishContext,
): Promise<PrintifyPublishResult> {
  const { supabase, userId, listingId, generation } = ctx;

  const printifyProductId = generation?.fulfillment?.printifyProductId?.trim();
  if (!printifyProductId) {
    await insertGumroadEvent(
      supabase,
      userId,
      "etsy_publish_failed",
      "Publish failed: no Printify product yet — run the product through the factory so fulfillment creates it first.",
      { listingId },
    );
    return null;
  }

  if (!isPrintifyConfigured()) {
    await insertGumroadEvent(
      supabase,
      userId,
      "etsy_skipped",
      "Publish skipped: Printify is not configured (PRINTIFY_API_TOKEN / PRINTIFY_SHOP_ID).",
      { listingId },
    );
    return null;
  }

  try {
    const adapter = createPrintifyAdapter();
    const result = await adapter.publishProduct(printifyProductId);
    const url = result.data.storefrontUrl;
    const externalId = result.data.externalId;

    const { data: updated, error } = await supabase
      .from(TABLES.LISTINGS)
      .update({
        gumroad_url: url,
        gumroad_product_id: externalId,
        status: "published",
      })
      .eq("id", listingId)
      .eq("user_id", userId)
      .select()
      .single();

    if (error || !updated) {
      await insertGumroadEvent(
        supabase,
        userId,
        "etsy_publish_failed",
        `Printify publish succeeded but saving the listing failed: ${error?.message ?? "unknown"}`,
        { listingId },
      );
      return null;
    }

    await insertGumroadEvent(
      supabase,
      userId,
      "etsy_published",
      `Published to Etsy via Printify (review and publish it live from Printify or Etsy): ${url}`,
      { listingId, printifyProductId, url, provider: "printify" },
    );

    // Etsy ranks listings with 5+ photos higher; Printify's own sync sends
    // only the default mockup, so top the gallery up via the Etsy API.
    await ensureEtsyMockupGallery(
      supabase,
      userId,
      listingId,
      printifyProductId,
      adapter,
    );

    return { listing: mapListingFromDb(updated), url };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown Printify publish error.";
    await insertGumroadEvent(
      supabase,
      userId,
      "etsy_publish_failed",
      `Printify publish failed: ${message}`,
      { listingId, provider: "printify" },
    );
    return null;
  }
}
