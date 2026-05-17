import type { ProductIdea, ProductListing, ReviewItem } from "@/lib/ajax/types";
import type {
  ProductGeneration,
  ProductIdeaBrainSnapshot,
} from "@/lib/product/domain";

/** Product Brain + Forge generation artifacts for QC display. */
export type ReviewPhase2Context = {
  brain: ProductIdeaBrainSnapshot | null;
  generation: ProductGeneration | null;
};

export const EMPTY_REVIEW_PHASE2: ReviewPhase2Context = {
  brain: null,
  generation: null,
};

/** Pending review with joined listing, idea, and optional Phase 2 data. */
export type PendingReviewDetail = ReviewItem & {
  listing: ProductListing;
  idea: ProductIdea | null;
  phase2: ReviewPhase2Context;
};
