import type { ProductIdea } from "@/lib/ajax/types";
import { collectStoreTags } from "@/lib/store/tags";
import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";

export type PublicStoreListing = {
  id: string;
  title: string | null;
  description: string | null;
  price: number | null;
  gumroadUrl: string | null;
  tags: string[];
};

type PublishedListingRow = {
  id: string;
  title: string | null;
  description: string | null;
  price: number | null;
  gumroad_url: string | null;
  status: string;
  created_at: string;
  product_ideas: {
    seo_keywords: string[] | null;
    raw_payload: unknown;
  } | null;
};

const PUBLIC_LISTING_SELECT = `
  id,
  title,
  description,
  price,
  gumroad_url,
  status,
  created_at,
  product_ideas (
    seo_keywords,
    raw_payload
  )
`;

function ideaForTags(
  row: PublishedListingRow["product_ideas"],
): ProductIdea | null {
  if (!row) return null;
  return {
    id: "",
    userId: "",
    source: "",
    niche: null,
    title: null,
    description: null,
    seoKeywords: row.seo_keywords ?? [],
    trendScore: 0,
    status: "selected",
    rawPayload: (row.raw_payload as Record<string, unknown>) ?? {},
    createdAt: "",
  };
}

function mapPublicRow(row: PublishedListingRow): PublicStoreListing {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    price: row.price,
    gumroadUrl: row.gumroad_url,
    tags: collectStoreTags(ideaForTags(row.product_ideas), null),
  };
}

/** Buyer-facing catalog: published listings only (anon + RLS). */
export async function fetchPublicStoreListings(
  supabase: Supabase,
): Promise<PublicStoreListing[]> {
  const { data, error } = await supabase
    .from(TABLES.LISTINGS)
    .select(PUBLIC_LISTING_SELECT)
    .eq("status", "published")
    .order("created_at", { ascending: false });

  if (error) throw error;

  return ((data ?? []) as unknown as PublishedListingRow[]).map(mapPublicRow);
}
