import type { ProductIdea, ProductListing, ReviewItem } from "@/lib/ajax/types";

/** Pending review with joined listing and source idea. */
export type PendingReviewDetail = ReviewItem & {
  listing: ProductListing;
  idea: ProductIdea | null;
};
