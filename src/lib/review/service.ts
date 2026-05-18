import { AGENT_SLUGS, ROOM_SLUGS } from "@/lib/ajax/constants";
import {
  mapContentJobFromDb,
  mapListingFromDb,
  mapReviewFromDb,
} from "@/lib/ajax/mappers";
import {
  NoQueuedContentError,
  PixelSimulatorError,
  runPixelMarketing,
} from "@/lib/ajax/pixel-simulator";
import type { ContentJob, ProductListing, ReviewItem } from "@/lib/ajax/types";
import type { Json } from "@/lib/supabase/database.types";
import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";

export class ReviewError extends Error {
  readonly code = "REVIEW_ERROR" as const;

  constructor(
    message: string,
    readonly statusCode = 400,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ReviewError";
  }
}

type PendingReviewRow = {
  id: string;
  user_id: string;
  listing_id: string;
  status: string;
  product_listings: {
    id: string;
    user_id: string;
    title: string | null;
    status: string;
    product_ideas: {
      brain_verdict: string | null;
    } | null;
  } | null;
};

async function loadPendingReview(
  supabase: Supabase,
  userId: string,
  reviewId: string,
): Promise<PendingReviewRow> {
  const { data, error } = await supabase
    .from(TABLES.REVIEW_QUEUE)
    .select(
      `
      id,
      user_id,
      listing_id,
      status,
      product_listings (
        id,
        user_id,
        title,
        status,
        product_ideas (
          brain_verdict
        )
      )
    `,
    )
    .eq("id", reviewId)
    .eq("user_id", userId)
    .single();

  if (error || !data) {
    throw new ReviewError("Review item not found.", 404, error);
  }

  if (data.status !== "pending") {
    throw new ReviewError("This review has already been processed.", 409);
  }

  if (!data.product_listings) {
    throw new ReviewError("Linked listing not found.", 404);
  }

  return data as PendingReviewRow;
}

async function insertEvent(
  supabase: Supabase,
  userId: string,
  payload: {
    event_type: string;
    message: string;
    agent_slug?: string | null;
    room?: string | null;
    metadata?: Json;
  },
) {
  const { error } = await supabase.from(TABLES.EVENTS).insert({
    user_id: userId,
    event_type: payload.event_type,
    message: payload.message,
    agent_slug: payload.agent_slug ?? null,
    room: payload.room ?? null,
    metadata: payload.metadata ?? {},
  });

  if (error) {
    throw new ReviewError("Failed to log factory event.", 500, error);
  }
}

async function setAgentState(
  supabase: Supabase,
  slug: string,
  status: "idle" | "working" | "waiting",
  room: string,
) {
  const { error } = await supabase
    .from(TABLES.AGENTS)
    .update({
      status,
      current_room: room,
      current_task_id: null,
      last_heartbeat: new Date().toISOString(),
    })
    .eq("slug", slug);

  if (error) {
    throw new ReviewError(`Failed to update agent "${slug}".`, 500, error);
  }
}

export type ApproveReviewResult = {
  ok: true;
  review: ReviewItem;
  listing: ProductListing;
  contentJob: ContentJob;
  message: string;
};

/**
 * Approve a pending listing: `approved` → Pixel schedules content → `published`
 * (demo storefront). Does not publish to Etsy or other external channels.
 */
export async function approveReview(
  supabase: Supabase,
  userId: string,
  reviewId: string,
): Promise<ApproveReviewResult> {
  const pending = await loadPendingReview(supabase, userId, reviewId);
  const brainVerdict = pending.product_listings?.product_ideas?.brain_verdict;
  if (brainVerdict === "blocked") {
    throw new ReviewError("Blocked products cannot be approved.", 403);
  }

  const listingId = pending.listing_id;
  const now = new Date().toISOString();

  const { data: reviewRow, error: reviewError } = await supabase
    .from(TABLES.REVIEW_QUEUE)
    .update({
      status: "approved",
      reviewed_at: now,
    })
    .eq("id", reviewId)
    .eq("user_id", userId)
    .select()
    .single();

  if (reviewError || !reviewRow) {
    throw new ReviewError("Failed to approve review.", 500, reviewError);
  }

  const { data: listingRow, error: listingError } = await supabase
    .from(TABLES.LISTINGS)
    .update({ status: "approved" })
    .eq("id", listingId)
    .eq("user_id", userId)
    .select()
    .single();

  if (listingError || !listingRow) {
    throw new ReviewError("Failed to approve listing.", 500, listingError);
  }

  const { error: feedbackError } = await supabase.from(TABLES.FEEDBACK).insert({
    user_id: userId,
    agent_slug: AGENT_SLUGS.FORGE,
    related_listing_id: listingId,
    feedback_type: "approval_note",
    feedback_text: "Approved listing. Continue similar style.",
  });

  if (feedbackError) {
    throw new ReviewError("Failed to save agent feedback.", 500, feedbackError);
  }

  await insertEvent(supabase, userId, {
    event_type: "review_approved",
    agent_slug: AGENT_SLUGS.FORGE,
    room: ROOM_SLUGS.REVIEW_GATE,
    message: "Human approved Forge's listing.",
    metadata: { reviewId, listingId },
  });

  const { data: jobRow, error: jobError } = await supabase
    .from(TABLES.CONTENT_JOBS)
    .insert({
      user_id: userId,
      listing_id: listingId,
      platform: "demo",
      content_type: "slideshow",
      status: "queued",
      caption: `Demo marketing pack for ${listingRow.title ?? "product"}`,
    })
    .select()
    .single();

  if (jobError || !jobRow) {
    throw new ReviewError("Failed to queue content job for Pixel.", 500, jobError);
  }

  await insertEvent(supabase, userId, {
    event_type: "content_queued",
    agent_slug: AGENT_SLUGS.PIXEL,
    room: ROOM_SLUGS.MEDIA_STUDIO,
    message: "Pixel queued marketing content for the approved listing.",
    metadata: { listingId, contentJobId: jobRow.id },
  });

  let pixelResult;
  try {
    pixelResult = await runPixelMarketing(supabase, userId);
  } catch (err) {
    if (err instanceof NoQueuedContentError || err instanceof PixelSimulatorError) {
      throw new ReviewError(
        err instanceof NoQueuedContentError
          ? "Listing approved but Pixel found no queued content."
          : err.message,
        500,
        err,
      );
    }
    throw err;
  }

  await setAgentState(
    supabase,
    AGENT_SLUGS.FORGE,
    "idle",
    ROOM_SLUGS.DESIGN_PRESS,
  );

  const processed =
    pixelResult.jobs.find((j) => j.contentJob.id === jobRow.id) ??
    pixelResult.jobs.find((j) => j.listing.id === listingId) ??
    pixelResult.jobs[0];

  return {
    ok: true,
    review: mapReviewFromDb(reviewRow),
    listing: processed?.listing ?? mapListingFromDb(listingRow),
    contentJob: processed?.contentJob ?? mapContentJobFromDb(jobRow),
    message: pixelResult.message,
  };
}

export type RejectReviewResult = {
  ok: true;
  review: ReviewItem;
  listing: ProductListing;
  message: string;
};

/**
 * Reject a pending listing with required human feedback for Forge.
 */
export async function rejectReview(
  supabase: Supabase,
  userId: string,
  reviewId: string,
  reason: string,
): Promise<RejectReviewResult> {
  const trimmed = reason.trim();
  if (!trimmed) {
    throw new ReviewError("Rejection reason is required.", 400);
  }

  const pending = await loadPendingReview(supabase, userId, reviewId);
  const listingId = pending.listing_id;
  const now = new Date().toISOString();

  const { data: reviewRow, error: reviewError } = await supabase
    .from(TABLES.REVIEW_QUEUE)
    .update({
      status: "rejected",
      rejection_reason: trimmed,
      reviewed_at: now,
    })
    .eq("id", reviewId)
    .eq("user_id", userId)
    .select()
    .single();

  if (reviewError || !reviewRow) {
    throw new ReviewError("Failed to reject review.", 500, reviewError);
  }

  const { data: listingRow, error: listingError } = await supabase
    .from(TABLES.LISTINGS)
    .update({ status: "rejected" })
    .eq("id", listingId)
    .eq("user_id", userId)
    .select()
    .single();

  if (listingError || !listingRow) {
    throw new ReviewError("Failed to reject listing.", 500, listingError);
  }

  const { error: feedbackError } = await supabase.from(TABLES.FEEDBACK).insert({
    user_id: userId,
    agent_slug: AGENT_SLUGS.FORGE,
    related_listing_id: listingId,
    feedback_type: "rejection",
    feedback_text: trimmed,
  });

  if (feedbackError) {
    throw new ReviewError("Failed to save agent feedback.", 500, feedbackError);
  }

  await insertEvent(supabase, userId, {
    event_type: "review_rejected",
    agent_slug: AGENT_SLUGS.FORGE,
    room: ROOM_SLUGS.REVIEW_GATE,
    message: `Human rejected Forge's listing: ${trimmed}`,
    metadata: { reviewId, listingId, reason: trimmed },
  });

  await setAgentState(
    supabase,
    AGENT_SLUGS.FORGE,
    "idle",
    ROOM_SLUGS.DESIGN_PRESS,
  );

  return {
    ok: true,
    review: mapReviewFromDb(reviewRow),
    listing: mapListingFromDb(listingRow),
    message: "Listing rejected. Feedback saved for Forge.",
  };
}
