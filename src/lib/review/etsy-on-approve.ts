import {
  createEtsyAdapter,
  EtsyAdapterError,
  listingPriceToCents,
} from "@/lib/ajax/adapters/etsy";
import { EtsyAuthError, refreshEtsyToken } from "@/lib/ajax/etsy-auth";
import { mapListingFromDb } from "@/lib/ajax/mappers";
import type { ProductListing } from "@/lib/ajax/types";
import type { ProductGeneration } from "@/lib/product/domain";
import { downloadProductMockup, downloadProductPdf } from "@/lib/product/pdf-storage";
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
  downloadMockup?: typeof downloadProductMockup;
};

/** Derive Etsy taxonomy hints from a listing title so we pick a sensible category. */
function taxonomyHintsFromTitle(title: string): string[] {
  const t = title.toLowerCase();
  const hints: string[] = [];
  if (/\bmug\b/.test(t)) hints.push("mug");
  if (/t-?shirt|\btee\b|\bshirt\b/.test(t)) hints.push("t-shirt", "shirt");
  if (/sweatshirt|hoodie/.test(t)) hints.push("sweatshirt", "hoodie");
  if (/tote/.test(t)) hints.push("tote bag", "tote");
  if (/phone\s*case|\bcase\b/.test(t)) hints.push("phone case");
  if (/poster/.test(t)) hints.push("poster", "print");
  if (/print|wall art|art print/.test(t)) hints.push("print");
  hints.push("print"); // default lean — most products are art prints
  return hints;
}

/**
 * Auto-publish to Etsy after Review Gate approval.
 * Never throws — failures are logged as factory events and approval continues.
 */
export async function publishListingToEtsyOnApprove(
  ctx: EtsyOnApproveContext,
  dependencies: EtsyPublishDependencies = {},
): Promise<EtsyOnApproveResult> {
  const { supabase, userId, listingId, listing, generation } = ctx;
  const refreshTokenFn = dependencies.refreshToken ?? refreshEtsyToken;
  const createAdapter = dependencies.createAdapter ?? createEtsyAdapter;
  const downloadMockup = dependencies.downloadMockup ?? downloadProductMockup;

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

  // POD listings have no PDF — the artwork mockup is the listing hero image.
  const mockupPath = generation?.mockupStoragePath?.trim();
  if (!mockupPath) {
    await insertGumroadEvent(
      supabase,
      userId,
      "etsy_publish_failed",
      "Etsy auto-publish failed: no artwork mockup ready for the listing.",
      { listingId },
    );
    return null;
  }

  const title = listing.title?.trim() || "Print-on-demand product";
  const description =
    listing.description?.trim() ||
    "Original made-to-order print-on-demand product.";
  const priceCents = listingPriceToCents(listing.price);

  try {
    const adapter = createAdapter();
    const baseName = title.replace(/[^\w.-]+/g, "_").slice(0, 80) || "product";

    // Etsy rejects listings without a leaf taxonomy_id. Resolve one from the
    // title; the draft is editable so the seller can refine the category later.
    let taxonomyId: number | undefined;
    try {
      taxonomyId = await adapter.resolveTaxonomyId(taxonomyHintsFromTitle(title));
    } catch {
      taxonomyId = undefined;
    }

    // Physical DRAFT listing — never auto-published live (see etsy.ts state="draft").
    const created = await adapter.createDraftListing({
      title,
      description,
      price_cents: priceCents,
      taxonomy_id: taxonomyId,
      shopId: credentials.shop_id,
      accessToken: credentials.access_token,
    });

    let mockupBuffer: Buffer | null = null;
    try {
      mockupBuffer = await downloadMockup(mockupPath);
      await adapter.uploadListingImage(
        created.listing_id,
        mockupBuffer,
        `${baseName}_mockup.jpg`,
        credentials.shop_id,
        credentials.access_token,
      );
    } catch (imageErr) {
      const imageMessage =
        imageErr instanceof Error
          ? imageErr.message
          : "Etsy listing image upload failed.";
      await insertGumroadEvent(
        supabase,
        userId,
        "etsy_image_upload_failed",
        `Etsy draft created but mockup image upload failed: ${imageMessage}`,
        { listingId, provider: "etsy", mockupPath },
      );
    }

    // Autonomous: render a square product video from the mockup and attach it to
    // the listing. Best-effort, gated by FAL_KEY — skips silently without a key
    // and never blocks or breaks the publish if rendering/upload fails.
    if (mockupBuffer) {
      try {
        const { renderAndAttachListingVideo } = await import(
          "@/lib/ajax/video/listing-video"
        );
        const vid = await renderAndAttachListingVideo({
          adapter,
          listingId: created.listing_id,
          shopId: credentials.shop_id,
          accessToken: credentials.access_token,
          mockupBuffer,
          title,
        });
        if (vid.ok) {
          await insertGumroadEvent(
            supabase,
            userId,
            "etsy_video_attached",
            "Attached an AI product video to the Etsy listing.",
            { listingId, provider: "etsy", etsyVideoId: vid.etsyVideoId },
          );
        } else if (!vid.skipped) {
          await insertGumroadEvent(
            supabase,
            userId,
            "etsy_video_skipped",
            `Listing video not attached: ${vid.reason}`,
            { listingId, provider: "etsy" },
          );
        }
      } catch {
        // never let the video step break publishing
      }
    }

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
      `Etsy draft created (review and publish it live on Etsy when ready): ${created.url}`,
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
