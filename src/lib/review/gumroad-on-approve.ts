import {
  createLemonSqueezyAdapter,
  type LemonSqueezyAdapter,
  LemonSqueezyAdapterError,
  listingPriceToCents,
} from "@/lib/ajax/adapters/lemonsqueezy";
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

export type GumroadPublishResult =
  | {
      ok: true;
      status: "published";
      message: string;
      listing: ProductListing;
      gumroadUrl: string;
      gumroadProductId: string;
    }
  | {
      ok: false;
      status: "failed" | "skipped";
      message: string;
      statusCode: number;
    };

export type GumroadPublishDependencies = {
  apiKey?: string;
  createAdapter?: (options: { apiKey: string }) => LemonSqueezyAdapter;
  downloadPdf?: typeof downloadProductPdf;
};

type GumroadPublishOptions = {
  missingTokenEventType?: "gumroad_skipped" | "store_publish_skipped";
  missingTokenStatus?: "skipped" | "failed";
  missingTokenStatusCode?: number;
  skippedMessage?: string;
  failureMessagePrefix?: string;
  dependencies?: GumroadPublishDependencies;
};

export async function insertGumroadEvent(
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
 * Shared store publish implementation (Lemon Squeezy) for approval auto-publish
 * and manual repair retries. Never throws — callers decide how to surface failures.
 *
 * Event names keep gumroad_* for backward compatibility; values land in gumroad_url
 * and gumroad_product_id columns.
 */
export async function publishListingToGumroad(
  ctx: GumroadOnApproveContext,
  options: GumroadPublishOptions = {},
): Promise<GumroadPublishResult> {
  const { supabase, userId, listingId, listing, generation } = ctx;
  const deps = options.dependencies ?? {};
  const apiKey = (deps.apiKey ?? process.env.LEMONSQUEEZY_API_KEY)?.trim();
  const failurePrefix =
    options.failureMessagePrefix ?? "Store auto-publish failed";

  if (!apiKey) {
    const message =
      options.skippedMessage ??
      "Store publish skipped (LEMONSQUEEZY_API_KEY not set).";
    await insertGumroadEvent(
      supabase,
      userId,
      options.missingTokenEventType ?? "gumroad_skipped",
      message,
      { listingId },
    );
    return {
      ok: false,
      status: options.missingTokenStatus ?? "skipped",
      message,
      statusCode: options.missingTokenStatusCode ?? 200,
    };
  }

  const pdfPath = generation?.pdf.storagePath?.trim();
  if (!pdfPath) {
    const message = `${failurePrefix}: no PDF storage path.`;
    await insertGumroadEvent(
      supabase,
      userId,
      "gumroad_publish_failed",
      message,
      { listingId },
    );
    return {
      ok: false,
      status: "failed",
      message,
      statusCode: 409,
    };
  }

  const title = listing.title?.trim() || "Digital product";
  const description =
    listing.description?.trim() || "Utility-first digital download.";
  const priceCents = listingPriceToCents(listing.price);

  try {
    const adapter = (deps.createAdapter ?? createLemonSqueezyAdapter)({
      apiKey,
    });
    const downloadPdf = deps.downloadPdf ?? downloadProductPdf;
    const pdfBuffer = await downloadPdf(pdfPath);
    const filename = `${title.replace(/[^\w.-]+/g, "_").slice(0, 80) || "product"}.pdf`;

    const created = await adapter.createProduct({
      name: title,
      description,
    });
    const variant = await adapter.getDefaultVariant(created.product_id);
    await adapter.setVariantPrice(variant.variant_id, priceCents);
    await adapter.uploadFile(variant.variant_id, pdfBuffer, filename);
    const published = await adapter.publishProduct(created.product_id);

    const { data: updated, error } = await supabase
      .from(TABLES.LISTINGS)
      .update({
        gumroad_url: published.buy_now_url,
        gumroad_product_id: published.product_id,
        status: "published",
      })
      .eq("id", listingId)
      .eq("user_id", userId)
      .select()
      .single();

    if (error || !updated) {
      throw new LemonSqueezyAdapterError(
        "Failed to save store fields on listing.",
        undefined,
        error,
      );
    }

    await insertGumroadEvent(
      supabase,
      userId,
      "gumroad_published",
      `Published to store: ${published.buy_now_url}`,
      {
        listingId,
        gumroadUrl: published.buy_now_url,
        gumroadProductId: published.product_id,
        provider: "lemonsqueezy",
      },
    );

    return {
      ok: true,
      status: "published",
      message: "Published listing to Lemon Squeezy.",
      listing: mapListingFromDb(updated),
      gumroadUrl: published.buy_now_url,
      gumroadProductId: published.product_id,
    };
  } catch (err) {
    const message =
      err instanceof LemonSqueezyAdapterError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Unknown store publish error.";
    const eventMessage = `${failurePrefix}: ${message}`;

    await insertGumroadEvent(
      supabase,
      userId,
      "gumroad_publish_failed",
      eventMessage,
      { listingId, provider: "lemonsqueezy" },
    );
    return {
      ok: false,
      status: "failed",
      message: eventMessage,
      statusCode:
        err instanceof LemonSqueezyAdapterError && err.statusCode ? 502 : 500,
    };
  }
}

/**
 * Auto-publish to Lemon Squeezy after Review Gate approval.
 * Never throws — failures are logged as factory events and approval continues.
 */
export async function publishListingToGumroadOnApprove(
  ctx: GumroadOnApproveContext,
): Promise<GumroadOnApproveResult> {
  const result = await publishListingToGumroad(ctx, {
    missingTokenEventType: "gumroad_skipped",
    missingTokenStatus: "skipped",
    missingTokenStatusCode: 200,
    skippedMessage:
      "Store auto-publish skipped (LEMONSQUEEZY_API_KEY not set).",
    failureMessagePrefix: "Store auto-publish failed",
  });

  if (result.ok) {
    return {
      listing: result.listing,
      gumroadUrl: result.gumroadUrl,
      gumroadProductId: result.gumroadProductId,
    };
  }

  return null;
}
