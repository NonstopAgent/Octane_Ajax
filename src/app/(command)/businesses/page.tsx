import { BusinessesDashboard } from "@/components/businesses/businesses-dashboard";
import { fetchBusinesses } from "@/lib/businesses/queries";
import { createClient } from "@/lib/supabase/server";

function configReady() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export default async function BusinessesPage() {
  const ready = configReady();
  let isAuthenticated = false;
  let initialBusinesses: Awaited<ReturnType<typeof fetchBusinesses>> = [];

  if (ready) {
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        isAuthenticated = true;
        initialBusinesses = await fetchBusinesses(supabase, user.id);
      }
    } catch (err) {
      console.error("[businesses page] failed to load businesses", err);
    }
  }

  return (
    <BusinessesDashboard
      initialBusinesses={initialBusinesses}
      isAuthenticated={isAuthenticated}
      configReady={ready}
    />
  );
}
