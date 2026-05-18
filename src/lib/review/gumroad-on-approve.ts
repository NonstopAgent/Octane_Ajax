import {
  createGumroadAdapter,
  GumroadAdapterError,
  listingPriceToCents,
} from "@/lib/ajax/adapters/gumroad";
import { mapListingFromDb } from "@/lib/ajax/mappers";
import type { ProductListing } from "@/lib/ajax/types";
import type { ProductGeneration } from "@/lib/product/domain";
import { downloadProductPdf } from "@/lib/product/pdf-storage";
import type { Json } from "@/lib/supabase/database.types";
import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";

export type GumroadOnApproveContext = {
  supabase: Supabase;
  userId: string;
  listingId: string;
  listing: ProductListing;
  generation: ProductGeneration | null;
};

export type GumroadOnApproveResult = {
  listing: ProductListing;
  gumroadUrl: string;
  gumroadProductId: string;
} | null;

async function insertGumroadEvent(
  supabase: Supabase,
  userId: string,
  eventType: string,
  message: string,
  metadata?: Json,
) {
  await supabase.from(TABLES.EVENTS).insert({
    user_id: userId,
    event_type: eventType,
    message,
    agent_slug: null,
    room: null,
    metadata: metadata ?? {},
  });
}

/**
 * Auto-publish to Gumroad after Review Gate approval.
 * Never throws — failures are logged as factory events and approval continues.
 */
export async function publishListingToGumroadOnApprove(
  ctx: GumroadOnApproveContext,
): Promise<GumroadOnApproveResult> {
  const { supabase, userId, listingId, listing, generation } = ctx;
  const token = process.env.GUMROAD_ACCESS_TOKEN?.trim();

  if (!token) {
    await insertGumroadEvent(
      supabase,
      userId,
      "gumroad_skipped",
      "Gumroad auto-publish skipped (GUMROAD_ACCESS_TOKEN not set).",
      { listingId },
    );
    return null;
  }

  const pdfPath = generation?.pdf.storagePath?.trim();
  if (!pdfPath) {
    await insertGumroadEvent(
      supabase,
      userId,
      "gumroad_publish_failed",
      "Gumroad auto-publish failed: no PDF storage path.",
      { listingId },
    );
    return null;
  }

  const title = listing.title?.trim() || "Digital product";
  const description =
    listing.description?.trim() || "Utility-first digital download.";
  const priceCents = listingPriceToCents(listing.price);

  try {
    const adapter = createGumroadAdapter({ accessToken: token });
    const pdfBuffer = await downloadProductPdf(pdfPath);
    const filename = `${title.replace(/[^\w.-]+/g, "_").slice(0, 80) || "product"}.pdf`;

    const created = await adapter.createProduct({
      name: title,
      description,
      price_cents: priceCents,
      published: false,
    });

    await adapter.uploadProductFile(
      created.product_id,
      pdfBuffer,
      filename,
    );
    await adapter.publishProduct(created.product_id);

    const { data: updated, error } = await supabase
      .from(TABLES.LISTINGS)
      .update({
        gumroad_url: created.short_url,
        gumroad_product_id: created.product_id,
        status: "published",
      })
      .eq("id", listingId)
      .eq("user_id", userId)
      .select()
      .single();

    if (error || !updated) {
      throw new GumroadAdapterError(
        "Failed to save Gumroad fields on listing.",
        undefined,
        error,
      );
    }

    await insertGumroadEvent(
      supabase,
      userId,
      "gumroad_published",
      `Published to Gumroad: ${created.short_url}`,
      {
        listingId,
        gumroadUrl: created.short_url,
        gumroadProductId: created.product_id,
      },
    );

    return {
      listing: mapListingFromDb(updated),
      gumroadUrl: created.short_url,
      gumroadProductId: created.product_id,
    };
  } catch (err) {
    const message =
      err instanceof GumroadAdapterError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Unknown Gumroad error.";

    await insertGumroadEvent(
      supabase,
      userId,
      "gumroad_publish_failed",
      `Gumroad auto-publish failed: ${message}`,
      { listingId },
    );
    return null;
  }
}
