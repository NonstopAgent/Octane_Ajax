import { MarketingDashboard } from "@/components/marketing/marketing-dashboard";
import { fetchMarketingContentJobs } from "@/lib/ajax/pixel/queries";
import { createClient } from "@/lib/supabase/server";

function configReady() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export default async function MarketingPage() {
  const ready = configReady();
  let isAuthenticated = false;
  let jobs: Awaited<ReturnType<typeof fetchMarketingContentJobs>> = [];

  if (ready) {
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        isAuthenticated = true;
        jobs = await fetchMarketingContentJobs(supabase, user.id);
      }
    } catch (err) {
      console.error("[marketing page] failed to load content jobs", err);
    }
  }

  return (
    <MarketingDashboard
      jobs={jobs}
      isAuthenticated={isAuthenticated}
      configReady={ready}
    />
  );
}
