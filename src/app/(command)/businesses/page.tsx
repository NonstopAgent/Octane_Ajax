import { BusinessesDashboard } from "@/components/businesses/businesses-dashboard";
import { isSupabaseConfigured } from "@/lib/auth/env";
import { fetchBusinesses } from "@/lib/businesses/queries";
import { getActiveBusinessId } from "@/lib/businesses/active";
import { createClient } from "@/lib/supabase/server";

export default async function BusinessesPage() {
  const ready = isSupabaseConfigured();
  let isAuthenticated = false;
  let initialBusinesses: Awaited<ReturnType<typeof fetchBusinesses>> = [];
  let activeBusinessId: string | null = null;

  if (ready) {
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        isAuthenticated = true;
        initialBusinesses = await fetchBusinesses(supabase, user.id);
        activeBusinessId = await getActiveBusinessId(supabase, user.id);
      }
    } catch (err) {
      console.error("[businesses page] failed to load businesses", err);
    }
  }

  return (
    <BusinessesDashboard
      initialBusinesses={initialBusinesses}
      activeBusinessId={activeBusinessId}
      isAuthenticated={isAuthenticated}
      configReady={ready}
    />
  );
}
