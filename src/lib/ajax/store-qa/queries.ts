import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";
import type { QaListingInput } from "@/lib/ajax/store-qa/audit";

type Row = {
  id: string;
  title: string | null;
  description: string | null;
  price: number | null;
  mockup_url: string | null;
  status: string | null;
  product_ideas: { seo_keywords: string[] | null } | null;
};

/**
 * Load the shop's LIVE listings (+ their idea tags) for a whole-store QA sweep.
 * Only `published` listings count — those are what's actually in the store. Rejected
 * or draft/test records (e.g. old off-niche experiments) are NOT part of the store,
 * so auditing them would just be noise.
 */
export async function fetchStoreListingsForQa(
  supabase: Supabase,
  userId: string,
): Promise<QaListingInput[]> {
  const { data, error } = await supabase
    .from(TABLES.LISTINGS)
    .select(
      "id, title, description, price, mockup_url, status, product_ideas ( seo_keywords )",
    )
    .eq("user_id", userId)
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error || !data) return [];
  return (data as unknown as Row[]).map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    price: r.price,
    mockupUrl: r.mockup_url,
    status: r.status,
    tags: r.product_ideas?.seo_keywords ?? undefined,
  }));
}
