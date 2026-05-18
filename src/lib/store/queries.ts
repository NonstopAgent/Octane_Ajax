import { mapIdeaFromDb, mapListingFromDb } from "@/lib/ajax/mappers";
import type { ListingStatus } from "@/lib/ajax/status";
import {
  mapGenerationFromDb,
  mapIdeaBrainFromDb,
} from "@/lib/product/mappers";
import { collectStoreTags } from "@/lib/store/tags";
import {
  isStoreListingStatus,
  STORE_LISTING_STATUSES,
  type StoreListingDetail,
} from "@/lib/store/types";
import type { ProductGeneration as DbGeneration } from "@/lib/supabase/database.types";
import type { ProductIdea as DbIdea } from "@/lib/supabase/database.types";
import type { ProductListing as DbListing } from "@/lib/supabase/database.types";
import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";

type IdeaRowJoined = DbIdea & {
  brain_score?: unknown;
  brain_validation?: unknown;
  brain_verdict?: string | null;
  brain_evaluated_at?: string | null;
};

type ListingRowWithIdea = DbListing & {
  product_ideas: IdeaRowJoined | null;
};

const LISTING_SELECT_PHASE2 = `
  *,
  product_ideas (
    *,
    brain_score,
    brain_validation,
    brain_verdict,
    brain_evaluated_at
  )
`;

const LISTING_SELECT_BASE = `
  *,
  product_ideas (*)
`;

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

function mapListingRow(
  row: ListingRowWithIdea,
  generationByListingId: Map<string, ReturnType<typeof mapGenerationFromDb>>,
): StoreListingDetail | null {
  if (!isStoreListingStatus(row.status)) return null;

  const listing = mapListingFromDb(row);
  const ideaRow = row.product_ideas;
  const idea = ideaRow ? mapIdeaFromDb(ideaRow) : null;
  const brain = ideaRow ? mapIdeaBrainFromDb(ideaRow) : null;
  const generation = generationByListingId.get(listing.id) ?? null;

  return {
    listing,
    idea,
    brain,
    generation,
    tags: collectStoreTags(idea, generation),
    displayStatus: row.status as ListingStatus,
  };
}

async function fetchListingRows(
  supabase: Supabase,
  userId: string,
  select: string,
  listingId?: string,
): Promise<ListingRowWithIdea[]> {
  let query = supabase
    .from(TABLES.LISTINGS)
    .select(select)
    .eq("user_id", userId)
    .in("status", [...STORE_LISTING_STATUSES])
    .order("created_at", { ascending: false });

  if (listingId) {
    query = query.eq("id", listingId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as ListingRowWithIdea[];
}

async function loadStoreListingRows(
  supabase: Supabase,
  userId: string,
  listingId?: string,
): Promise<ListingRowWithIdea[]> {
  try {
    return await fetchListingRows(supabase, userId, LISTING_SELECT_PHASE2, listingId);
  } catch (err) {
    if (!isSchemaGapError(err)) throw err;
    return fetchListingRows(supabase, userId, LISTING_SELECT_BASE, listingId);
  }
}

async function mapStoreRows(
  supabase: Supabase,
  userId: string,
  rows: ListingRowWithIdea[],
): Promise<StoreListingDetail[]> {
  const listingIds = rows.map((row) => row.id);

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
    .map((row) => mapListingRow(row, generationByListingId))
    .filter((item): item is StoreListingDetail => item !== null);
}

/** Approved and published listings for the signed-in operator storefront. */
export async function fetchStoreListings(
  supabase: Supabase,
  userId: string,
): Promise<StoreListingDetail[]> {
  const rows = await loadStoreListingRows(supabase, userId);
  return mapStoreRows(supabase, userId, rows);
}

/** Single storefront listing when it is approved or published. */
export async function fetchStoreListingById(
  supabase: Supabase,
  userId: string,
  listingId: string,
): Promise<StoreListingDetail | null> {
  const rows = await loadStoreListingRows(supabase, userId, listingId);
  const mapped = await mapStoreRows(supabase, userId, rows);
  return mapped[0] ?? null;
}
