import {
  mapIdeaFromDb,
  mapListingFromDb,
  mapReviewFromDb,
} from "@/lib/ajax/mappers";
import {
  mapGenerationFromDb,
  mapIdeaBrainFromDb,
} from "@/lib/product/mappers";
import type { ProductGeneration as DbGeneration } from "@/lib/supabase/database.types";
import type { ProductIdea as DbIdea } from "@/lib/supabase/database.types";
import type { PendingReviewDetail, ReviewPhase2Context } from "@/lib/review/types";
import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";

type IdeaRowJoined = DbIdea & {
  brain_score?: unknown;
  brain_validation?: unknown;
  brain_verdict?: string | null;
  brain_evaluated_at?: string | null;
};

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
    gumroad_url: string | null;
    gumroad_product_id: string | null;
    status: string;
    created_at: string;
    product_ideas: IdeaRowJoined | null;
  } | null;
};

function isSchemaGapError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: string; message?: string; details?: string };
  const msg = `${record.message ?? ""} ${record.details ?? ""}`.toLowerCase();
  return (
    record.code === "PGRST204" ||
    record.code === "42703" ||
    record.code === "42P01" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache") ||
    msg.includes("could not find")
  );
}

function buildPhase2FromIdea(ideaRow: IdeaRowJoined | null): Pick<
  ReviewPhase2Context,
  "brain"
> {
  if (!ideaRow) return { brain: null };
  return { brain: mapIdeaBrainFromDb(ideaRow) };
}

function mapRow(
  row: ReviewRowWithJoins,
  generationByListingId: Map<string, ReturnType<typeof mapGenerationFromDb>>,
): PendingReviewDetail | null {
  if (!row.product_listings) return null;

  const review = mapReviewFromDb(row);
  const listing = mapListingFromDb(row.product_listings);
  const ideaRow = row.product_listings.product_ideas;
  const generation = generationByListingId.get(listing.id) ?? null;

  const phase2: ReviewPhase2Context = {
    ...buildPhase2FromIdea(ideaRow),
    generation,
  };

  return {
    ...review,
    listing,
    idea: ideaRow ? mapIdeaFromDb(ideaRow) : null,
    phase2,
  };
}

const REVIEW_SELECT_BASE = `
  *,
  product_listings (
    *,
    product_ideas (*)
  )
`;

const REVIEW_SELECT_PHASE2 = `
  *,
  product_listings (
    *,
    product_ideas (
      *,
      brain_score,
      brain_validation,
      brain_verdict,
      brain_evaluated_at
    )
  )
`;

async function fetchPendingReviewRows(
  supabase: Supabase,
  userId: string,
  select: string,
): Promise<ReviewRowWithJoins[]> {
  const { data, error } = await supabase
    .from(TABLES.REVIEW_QUEUE)
    .select(select)
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data ?? []) as unknown as ReviewRowWithJoins[];
}

async function fetchGenerationsByListingId(
  supabase: Supabase,
  userId: string,
  listingIds: string[],
): Promise<Map<string, ReturnType<typeof mapGenerationFromDb>>> {
  const map = new Map<string, ReturnType<typeof mapGenerationFromDb>>();
  if (listingIds.length === 0) return map;

  const { data, error } = await supabase
    .from(TABLES.GENERATIONS)
    .select("*")
    .eq("user_id", userId)
    .in("product_listing_id", listingIds)
    .order("updated_at", { ascending: false });

  if (error) {
    if (isSchemaGapError(error)) return map;
    throw error;
  }

  for (const row of (data ?? []) as DbGeneration[]) {
    const listingId = row.product_listing_id;
    if (!listingId || map.has(listingId)) continue;
    map.set(listingId, mapGenerationFromDb(row));
  }

  return map;
}

/** Pending reviews with listing, idea, and Phase 2 QC data when available. */
export async function fetchPendingReviews(
  supabase: Supabase,
  userId: string,
): Promise<PendingReviewDetail[]> {
  let rows: ReviewRowWithJoins[];

  try {
    rows = await fetchPendingReviewRows(supabase, userId, REVIEW_SELECT_PHASE2);
  } catch (err) {
    if (!isSchemaGapError(err)) throw err;
    rows = await fetchPendingReviewRows(supabase, userId, REVIEW_SELECT_BASE);
  }

  const listingIds = rows
    .map((r) => r.product_listings?.id)
    .filter((id): id is string => Boolean(id));

  let generationByListingId: Map<
    string,
    ReturnType<typeof mapGenerationFromDb>
  >;
  try {
    generationByListingId = await fetchGenerationsByListingId(
      supabase,
      userId,
      listingIds,
    );
  } catch (err) {
    if (!isSchemaGapError(err)) throw err;
    generationByListingId = new Map();
  }

  return rows
    .map((row) => mapRow(row, generationByListingId))
    .filter((r): r is PendingReviewDetail => r !== null);
}
