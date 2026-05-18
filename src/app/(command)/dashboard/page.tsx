import { DashboardView } from "@/components/dashboard/dashboard-view";
import {
  fetchDashboardAgents,
  fetchRecentDashboardEvents,
  getPipelineFunnel,
  getPublishedListingCount,
  getWeeklyApprovedListingCount,
  getWeeklyGenerationCount,
} from "@/lib/factory/revenue-queries";
import type { RevenueDashboardData } from "@/lib/factory/revenue-types";
import { createClient } from "@/lib/supabase/server";

const EMPTY_DASHBOARD: RevenueDashboardData = {
  agents: [],
  funnel: { ideas: 0, passed: 0, approved: 0, published: 0 },
  thisWeek: {
    productsGenerated: 0,
    passedQualityGate: 0,
    approved: 0,
    liveOnEtsy: 0,
  },
  recentEvents: [],
};

function configReady() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export default async function DashboardPage() {
  const ready = configReady();
  let isAuthenticated = false;
  let dashboard = EMPTY_DASHBOARD;

  if (ready) {
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        isAuthenticated = true;
        const [
          agents,
          funnel,
          productsGenerated,
          approved,
          liveOnEtsy,
          recentEvents,
        ] = await Promise.all([
          fetchDashboardAgents(supabase),
          getPipelineFunnel(supabase, user.id),
          getWeeklyGenerationCount(supabase, user.id),
          getWeeklyApprovedListingCount(supabase, user.id),
          getPublishedListingCount(supabase, user.id),
          fetchRecentDashboardEvents(supabase, user.id, 8),
        ]);

        dashboard = {
          agents,
          funnel,
          thisWeek: {
            productsGenerated,
            passedQualityGate: funnel.passed,
            approved,
            liveOnEtsy,
          },
          recentEvents,
        };
      }
    } catch (err) {
      console.error("[dashboard] load failed", err);
    }
  }

  return (
    <DashboardView
      dashboard={dashboard}
      isAuthenticated={isAuthenticated}
      configReady={ready}
    />
  );
}
