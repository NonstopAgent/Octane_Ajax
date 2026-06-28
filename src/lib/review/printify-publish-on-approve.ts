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
} from "@/lib/ajax/adapters/printify";
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
