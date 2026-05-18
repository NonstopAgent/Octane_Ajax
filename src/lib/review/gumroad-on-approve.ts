import {
  createGumroadAdapter,
  type GumroadAdapter,
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
  accessToken?: string;
  createAdapter?: (options: { accessToken: string }) => GumroadAdapter;
  downloadPdf?: typeof downloadProductPdf;
};

type GumroadPublishOptions = {
  missingTokenEventType?: "gumroad_skipped" | "gumroad_publish_failed";
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
 * Shared Gumroad publish implementation for approval auto-publish and manual
 * repair retries. Never throws — callers decide how to surface failures.
 */
export async function publishListingToGumroad(
  ctx: GumroadOnApproveContext,
  options: GumroadPublishOptions = {},
): Promise<GumroadPublishResult> {
  const { supabase, userId, listingId, listing, generation } = ctx;
  const deps = options.dependencies ?? {};
  const token = (deps.accessToken ?? process.env.GUMROAD_ACCESS_TOKEN)?.trim();
  const failurePrefix = options.failureMessagePrefix ?? "Gumroad auto-publish failed";

  if (!token) {
    const message =
      options.skippedMessage ??
      "Gumroad publish failed: GUMROAD_ACCESS_TOKEN is not configured.";
    await insertGumroadEvent(
      supabase,
      userId,
      options.missingTokenEventType ?? "gumroad_publish_failed",
      message,
      { listingId },
    );
    return {
      ok: false,
      status: options.missingTokenStatus ?? "failed",
      message,
      statusCode: options.missingTokenStatusCode ?? 503,
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
    const adapter = (deps.createAdapter ?? createGumroadAdapter)({
      accessToken: token,
    });
    const downloadPdf = deps.downloadPdf ?? downloadProductPdf;
    const pdfBuffer = await downloadPdf(pdfPath);
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
      ok: true,
      status: "published",
      message: "Published listing to Gumroad.",
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
    const eventMessage = `${failurePrefix}: ${message}`;

    await insertGumroadEvent(
      supabase,
      userId,
      "gumroad_publish_failed",
      eventMessage,
      { listingId },
    );
    return {
      ok: false,
      status: "failed",
      message: eventMessage,
      statusCode: err instanceof GumroadAdapterError && err.statusCode ? 502 : 500,
    };
  }
}

/**
 * Auto-publish to Gumroad after Review Gate approval.
 * Never throws — failures are logged as factory events and approval continues.
 */
export async function publishListingToGumroadOnApprove(
  ctx: GumroadOnApproveContext,
): Promise<GumroadOnApproveResult> {
  const result = await publishListingToGumroad(ctx, {
    missingTokenEventType: "gumroad_skipped",
    missingTokenStatus: "skipped",
    missingTokenStatusCode: 200,
    skippedMessage: "Gumroad auto-publish skipped (GUMROAD_ACCESS_TOKEN not set).",
    failureMessagePrefix: "Gumroad auto-publish failed",
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
