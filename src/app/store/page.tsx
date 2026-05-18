import { PublicStoreCatalog } from "@/components/store/public-store-catalog";
import { fetchPublicStoreListings } from "@/lib/store/public-queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function configReady() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export default async function PublicStorePage() {
  const ready = configReady();
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
