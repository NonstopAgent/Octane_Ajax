import type { PixelPromoMetadata } from "@/lib/ajax/pixel-promo-package";
import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";

export type MarketingContentJob = {
  id: string;
  listingId: string;
  listingTitle: string | null;
  platform: string;
  contentType: string;
  status: string;
  scheduledFor: string | null;
  metadata: PixelPromoMetadata | null;
};

function parsePromoMetadata(raw: unknown): PixelPromoMetadata | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  if (
    typeof m.shortCaption !== "string" ||
    !Array.isArray(m.tiktokHookIdeas) ||
    !Array.isArray(m.hashtags)
  ) {
    return null;
  }
  return m as PixelPromoMetadata;
}

export async function fetchMarketingContentJobs(
  supabase: Supabase,
  userId: string,
): Promise<MarketingContentJob[]> {
  const { data, error } = await supabase
    .from(TABLES.CONTENT_JOBS)
    .select(
      `
      id,
      listing_id,
      platform,
      content_type,
      status,
      scheduled_for,
      metadata,
      product_listings ( title )
    `,
    )
    .eq("user_id", userId)
    .not("metadata", "is", null)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load marketing content jobs: ${error.message}`);
  }

  return (data ?? []).map((row) => {
    const listing = row.product_listings as { title?: string | null } | null;

    return {
      id: row.id,
      listingId: row.listing_id,
      listingTitle: listing?.title ?? null,
      platform: row.platform,
      contentType: row.content_type,
      status: row.status,
      scheduledFor: row.scheduled_for,
      metadata: parsePromoMetadata(row.metadata),
    };
  });
}
