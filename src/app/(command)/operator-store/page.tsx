import { StoreDashboard } from "@/components/store/store-dashboard";
import { fetchStoreListings } from "@/lib/store/queries";
import { createClient } from "@/lib/supabase/server";

function configReady() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export default async function OperatorStorePage() {
  const ready = configReady();
  let isAuthenticated = false;
  let listings: Awaited<ReturnType<typeof fetchStoreListings>> = [];

  if (ready) {
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        isAuthenticated = true;
        listings = await fetchStoreListings(supabase, user.id);
      }
    } catch (err) {
      console.error("[operator store page] failed to load listings", err);
    }
  }

  return (
    <StoreDashboard
      listings={listings}
      isAuthenticated={isAuthenticated}
      configReady={ready}
    />
  );
}
