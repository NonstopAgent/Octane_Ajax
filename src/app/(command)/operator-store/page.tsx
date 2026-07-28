import { StoreDashboard } from "@/components/store/store-dashboard";
import { isSupabaseConfigured } from "@/lib/auth/env";
import { fetchStoreListings } from "@/lib/store/queries";
import { createClient } from "@/lib/supabase/server";

export default async function OperatorStorePage() {
  const ready = isSupabaseConfigured();
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
