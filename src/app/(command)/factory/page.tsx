import { FactorySweatshop } from "@/components/factory/factory-sweatshop";
import { fetchSweatshopSnapshot } from "@/lib/factory/queries";
import { fetchPrimaryBusiness } from "@/lib/businesses/queries";
import { createClient } from "@/lib/supabase/server";
import type { VisMetrics } from "@/components/factory/factory-vis-map";

function configReady() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

const EMPTY_METRICS: VisMetrics = {
  productIdeas: 0,
  pendingReviews: 0,
  scheduledContent: 0,
  publishedListings: 0,
};

export default async function FactoryPage() {
  const ready = configReady();
  let isAuthenticated = false;
  let snapshot: Awaited<ReturnType<typeof fetchSweatshopSnapshot>> | null = null;
  let businessLabel = "BUSINESS 01 · GOTCHADAYGOODS";

  if (ready) {
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        isAuthenticated = true;
        snapshot = await fetchSweatshopSnapshot(supabase, user.id);
        const primary = await fetchPrimaryBusiness(supabase, user.id);
        if (primary) businessLabel = `BUSINESS 01 · ${primary.name.toUpperCase()}`;
      }
    } catch (err) {
      console.error("[factory page] failed to load snapshot", err);
    }
  }

  return (
    <FactorySweatshop
      isAuthenticated={isAuthenticated}
      configReady={ready}
      initialEvents={snapshot?.events ?? []}
      initialOrders={snapshot?.orders ?? []}
      initialTikTokQueue={snapshot?.tiktokQueue ?? []}
      initialAgents={snapshot?.agents ?? []}
      initialMetrics={snapshot?.metrics ?? EMPTY_METRICS}
      businessLabel={businessLabel}
    />
  );
}
