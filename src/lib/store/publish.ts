import { mapListingFromDb } from "@/lib/ajax/mappers";
import type { ProductListing } from "@/lib/ajax/types";
import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";

export class StorePublishError extends Error {
  readonly code = "STORE_PUBLISH_ERROR" as const;

  constructor(
    message: string,
    readonly statusCode = 400,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "StorePublishError";
  }
}

const GUMROAD_HOST_PATTERN = /^https:\/\/([a-z0-9-]+\.)?gumroad\.com\//i;

export function normalizeGumroadUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new StorePublishError("Gumroad URL is required.", 400);
  }

  let url: URL;
  try {
    url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
  } catch {
    throw new StorePublishError("Enter a valid Gumroad product URL.", 400);
  }

  if (url.protocol !== "https:") {
    throw new StorePublishError("Gumroad URL must use HTTPS.", 400);
  }

  if (!GUMROAD_HOST_PATTERN.test(`${url.origin}/`)) {
    throw new StorePublishError(
      "URL must be a Gumroad link (gumroad.com or *.gumroad.com).",
      400,
    );
  }

  return url.toString();
}

export type PublishListingResult = {
  ok: true;
  listing: ProductListing;
  message: string;
};

/**
 * Persist Gumroad checkout URL and publish listing to the public /store catalog.
 * Listing must be approved or already published (update URL).
 */
export async function publishListingWithGumroad(
  supabase: Supabase,
  userId: string,
  listingId: string,
  gumroadUrlRaw: string,
): Promise<PublishListingResult> {
  const gumroadUrl = normalizeGumroadUrl(gumroadUrlRaw);

  const { data: existing, error: loadError } = await supabase
    .from(TABLES.LISTINGS)
    .select("id, status")
    .eq("id", listingId)
    .eq("user_id", userId)
    .single();

  if (loadError || !existing) {
    throw new StorePublishError("Listing not found.", 404, loadError);
  }

  if (existing.status !== "approved" && existing.status !== "published") {
    throw new StorePublishError(
      "Only approved listings can be published to the public store.",
      409,
    );
  }

  const { data: row, error: updateError } = await supabase
    .from(TABLES.LISTINGS)
    .update({
      gumroad_url: gumroadUrl,
      status: "published",
    })
    .eq("id", listingId)
    .eq("user_id", userId)
    .select()
    .single();

  if (updateError || !row) {
    throw new StorePublishError("Failed to publish listing.", 500, updateError);
  }

  return {
    ok: true,
    listing: mapListingFromDb(row),
    message: "Listing published to the public store with Gumroad checkout.",
  };
}
