import {
  mapIdeaFromDb,
  mapListingFromDb,
  mapReviewFromDb,
} from "@/lib/ajax/mappers";
import type { ProductIdea as DbIdea } from "@/lib/supabase/database.types";
import type { PendingReviewDetail } from "@/lib/review/types";
import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";

type ReviewRowWithJoins = {
  id: string;
  user_id: string;
  listing_id: string;
  status: string;
  reviewer_notes: string | null;
  rejection_reason: string | null;
  reviewed_at: string | null;
  created_at: string;
  product_listings: {
    id: string;
    user_id: string;
    product_idea_id: string;
    title: string | null;
    description: string | null;
    price: number | null;
    mockup_url: string | null;
    platform: string;
    external_listing_id: string | null;
    status: string;
    created_at: string;
    product_ideas: {
      id: string;
      user_id: string;
      source: string;
      niche: string | null;
      title: string | null;
      description: string | null;
      seo_keywords: string[];
      trend_score: number;
      status: string;
      raw_payload: unknown;
      created_at: string;
    } | null;
  } | null;
};

function mapRow(row: ReviewRowWithJoins): PendingReviewDetail | null {
  if (!row.product_listings) return null;

  const review = mapReviewFromDb(row);
  const listing = mapListingFromDb(row.product_listings);
  const ideaRow = row.product_listings.product_ideas;

  return {
    ...review,
    listing,
    idea: ideaRow ? mapIdeaFromDb(ideaRow as DbIdea) : null,
  };
}

/** Pending reviews with listing + product idea for the review UI. */
export async function fetchPendingReviews(
  supabase: Supabase,
  userId: string,
): Promise<PendingReviewDetail[]> {
  const { data, error } = await supabase
    .from(TABLES.REVIEW_QUEUE)
    .select(
      `
      *,
      product_listings (
        *,
        product_ideas (*)
      )
    `,
    )
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) throw error;

  return (data as ReviewRowWithJoins[])
    .map(mapRow)
    .filter((r): r is PendingReviewDetail => r !== null);
}
