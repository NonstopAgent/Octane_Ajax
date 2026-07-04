import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";
import type { Business } from "@/lib/businesses/types";

type BusinessRow = {
  id: string;
  name: string;
  slug: string | null;
  niche: string | null;
  brand: string | null;
  status: string;
  is_primary: boolean;
  created_at: string;
};

function mapBusiness(r: BusinessRow): Business {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    niche: r.niche,
    brand: r.brand,
    status: r.status,
    isPrimary: r.is_primary,
    createdAt: r.created_at,
  };
}

/** All businesses owned by the user, primary first. Never throws. */
export async function fetchBusinesses(
  supabase: Supabase,
  userId: string,
): Promise<Business[]> {
  const { data, error } = await supabase
    .from(TABLES.BUSINESSES)
    .select("*")
    .eq("user_id", userId)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return data.map(mapBusiness);
}

/** The primary business (falls back to the oldest, or null if none). */
export async function fetchPrimaryBusiness(
  supabase: Supabase,
  userId: string,
): Promise<Business | null> {
  const list = await fetchBusinesses(supabase, userId);
  return list.find((b) => b.isPrimary) ?? list[0] ?? null;
}

/** Registers a new business for the user. Returns the created row (or null). */
export async function createBusiness(
  supabase: Supabase,
  userId: string,
  input: { name: string; niche?: string | null; brand?: string | null },
): Promise<Business | null> {
  const name = input.name.trim().slice(0, 120);
  if (!name) return null;
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const { data, error } = await supabase
    .from(TABLES.BUSINESSES)
    .insert({
      user_id: userId,
      name,
      slug: slug || null,
      niche: input.niche?.trim().slice(0, 200) || null,
      brand: input.brand?.trim().slice(0, 120) || name,
      status: "provisioning",
      is_primary: false,
    })
    .select("*")
    .single();
  if (error || !data) return null;
  return mapBusiness(data);
}
