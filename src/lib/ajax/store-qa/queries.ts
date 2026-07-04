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

/** Load the shop's listings (+ their idea tags) for a whole-store QA sweep. */
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
