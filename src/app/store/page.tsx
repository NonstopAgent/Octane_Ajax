import { PublicStoreCatalog } from "@/components/store/public-store-catalog";
import { isSupabaseConfigured } from "@/lib/auth/env";
import { fetchPublicStoreListings } from "@/lib/store/public-queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function PublicStorePage() {
  const ready = isSupabaseConfigured();
  let listings: Awaited<ReturnType<typeof fetchPublicStoreListings>> = [];

  if (ready) {
    try {
      const supabase = await createClient();
      listings = await fetchPublicStoreListings(supabase);
    } catch (err) {
      console.error("[public store] failed to load listings", err);
    }
  }

  return (
    <PublicStoreCatalog listings={listings} configReady={ready} />
  );
}
