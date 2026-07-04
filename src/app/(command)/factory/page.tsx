import { FactorySweatshop } from "@/components/factory/factory-sweatshop";
import { fetchSweatshopSnapshot } from "@/lib/factory/queries";
import { fetchBusinesses } from "@/lib/businesses/queries";
import { getActiveBusiness } from "@/lib/businesses/active";
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
  let businessId: string | null = null;
  let businessIncludeNull = false;

  if (ready) {
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        isAuthenticated = true;
        const businesses = await fetchBusinesses(supabase, user.id);
        const active = await getActiveBusiness(supabase, user.id);
        if (active) {
          businessId = active.id;
          businessIncludeNull = active.isPrimary;
          const idx = businesses.findIndex((b) => b.id === active.id);
          const n = String((idx >= 0 ? idx : 0) + 1).padStart(2, "0");
          businessLabel = `BUSINESS ${n} · ${active.name.toUpperCase()}`;
        }
        snapshot = await fetchSweatshopSnapshot(
          supabase,
          user.id,
          businessId,
          businessIncludeNull,
        );
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
      businessId={businessId}
      businessIncludeNull={businessIncludeNull}
    />
  );
}
