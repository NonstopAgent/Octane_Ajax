import {
  createEtsyAdapter,
  EtsyAdapterError,
  listingPriceToCents,
} from "@/lib/ajax/adapters/etsy";
import { EtsyAuthError, refreshEtsyToken } from "@/lib/ajax/etsy-auth";
import { mapListingFromDb } from "@/lib/ajax/mappers";
import type { ProductListing } from "@/lib/ajax/types";
import type { ProductGeneration } from "@/lib/product/domain";
import { downloadProductPdf } from "@/lib/product/pdf-storage";
import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";
import { insertGumroadEvent } from "@/lib/review/gumroad-on-approve";

export type EtsyOnApproveContext = {
  supabase: Supabase;
  userId: string;
  listingId: string;
  listing: ProductListing;
  generation: ProductGeneration | null;
};

export type EtsyOnApproveResult = {
  listing: ProductListing;
  etsyUrl: string;
  etsyListingId: string;
} | null;

export type EtsyPublishDependencies = {
  refreshToken?: typeof refreshEtsyToken;
  createAdapter?: typeof createEtsyAdapter;
  downloadPdf?: typeof downloadProductPdf;
};

/**
 * Auto-publish to Etsy after Review Gate approval (after content job + Lemon Squeezy).
 * Never throws — failures are logged as factory events and approval continues.
 */
export async function publishListingToEtsyOnApprove(
  ctx: EtsyOnApproveContext,
  dependencies: EtsyPublishDependencies = {},
): Promise<EtsyOnApproveResult> {
  const { supabase, userId, listingId, listing, generation } = ctx;
  const refreshTokenFn = dependencies.refreshToken ?? refreshEtsyToken;
  const createAdapter = dependencies.createAdapter ?? createEtsyAdapter;
  const downloadPdf = dependencies.downloadPdf ?? downloadProductPdf;

  let credentials;
  try {
    credentials = await refreshTokenFn(userId, { supabase });
  } catch (err) {
    const message =
      err instanceof EtsyAuthError || err instanceof EtsyAdapterError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Etsy token refresh failed.";
    await insertGumroadEvent(
      supabase,
      userId,
      "etsy_publish_failed",
      `Etsy auto-publish failed: ${message}`,
      { listingId },
    );
    return null;
  }

  if (!credentials) {
    await insertGumroadEvent(
      supabase,
      userId,
      "etsy_skipped",
      "Etsy auto-publish skipped (Etsy shop not connected).",
      { listingId },
    );
    return null;
  }

  const pdfPath = generation?.pdf.storagePath?.trim();
  if (!pdfPath) {
    await insertGumroadEvent(
      supabase,
      userId,
      "etsy_publish_failed",
      "Etsy auto-publish failed: no PDF storage path.",
      { listingId },
    );
    return null;
  }

  const title = listing.title?.trim() || "Digital product";
  const description =
    listing.description?.trim() || "Utility-first digital download.";
  const priceCents = listingPriceToCents(listing.price);

  try {
    const adapter = createAdapter();
    const pdfBuffer = await downloadPdf(pdfPath);
    const filename = `${title.replace(/[^\w.-]+/g, "_").slice(0, 80) || "product"}.pdf`;

    const created = await adapter.createDraftListing({
      title,
      description,
      price_cents: priceCents,
      shopId: credentials.shop_id,
      accessToken: credentials.access_token,
    });

    await adapter.uploadListingFile(
      created.listing_id,
      pdfBuffer,
      filename,
      credentials.shop_id,
      credentials.access_token,
    );

    const { data: updated, error } = await supabase
      .from(TABLES.LISTINGS)
      .update({
        gumroad_url: created.url,
        gumroad_product_id: created.listing_id,
        status: "published",
      })
      .eq("id", listingId)
      .eq("user_id", userId)
      .select()
      .single();

    if (error || !updated) {
      throw new EtsyAdapterError(
        "Failed to save Etsy listing fields on product_listings.",
        undefined,
        error,
      );
    }

    await insertGumroadEvent(
      supabase,
      userId,
      "etsy_published",
      `Published to Etsy: ${created.url}`,
      {
        listingId,
        etsyUrl: created.url,
        etsyListingId: created.listing_id,
        provider: "etsy",
      },
    );

    return {
      listing: mapListingFromDb(updated),
      etsyUrl: created.url,
      etsyListingId: created.listing_id,
    };
  } catch (err) {
    const message =
      err instanceof EtsyAdapterError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Unknown Etsy publish error.";
    await insertGumroadEvent(
      supabase,
      userId,
      "etsy_publish_failed",
      `Etsy auto-publish failed: ${message}`,
      { listingId, provider: "etsy" },
    );
    return null;
  }
}
