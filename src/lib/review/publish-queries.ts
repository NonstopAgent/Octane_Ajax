import { mapListingFromDb } from "@/lib/ajax/mappers";
import type { ProductListing } from "@/lib/ajax/types";
import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";

/** Approved (or published without Gumroad) listings ready for external publish. */
export async function fetchListingsAwaitingGumroad(
  supabase: Supabase,
  userId: string,
): Promise<ProductListing[]> {
  const { data, error } = await supabase
    .from(TABLES.LISTINGS)
    .select("*")
    .eq("user_id", userId)
    .in("status", ["approved", "published"])
    .is("gumroad_url", null)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map(mapListingFromDb);
}
