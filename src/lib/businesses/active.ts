import { cookies } from "next/headers";
import type { Supabase } from "@/lib/supabase/helpers";
import type { Business } from "@/lib/businesses/types";
import { fetchBusinesses } from "@/lib/businesses/queries";

/** Cookie holding the operator's currently-selected business id. */
export const ACTIVE_BUSINESS_COOKIE = "ajax_business";

/**
 * The business new production is attributed to. A valid selected cookie wins;
 * otherwise the primary business (falls back to the first, or null if none).
 * Always safe: with no cookie set, this is the primary business — identical to
 * the single-shop behavior.
 */
export async function getActiveBusiness(
  supabase: Supabase,
  userId: string,
): Promise<Business | null> {
  const list = await fetchBusinesses(supabase, userId);
  if (list.length === 0) return null;
  const store = await cookies();
  const selected = store.get(ACTIVE_BUSINESS_COOKIE)?.value;
  if (selected) {
    const match = list.find((b) => b.id === selected);
    if (match) return match;
  }
  return list.find((b) => b.isPrimary) ?? list[0];
}

export async function getActiveBusinessId(
  supabase: Supabase,
  userId: string,
): Promise<string | null> {
  return (await getActiveBusiness(supabase, userId))?.id ?? null;
}
