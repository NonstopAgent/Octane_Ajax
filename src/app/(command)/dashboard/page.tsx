import { DashboardView } from "@/components/dashboard/dashboard-view";
import { fetchFactorySnapshot } from "@/lib/factory/queries";
import type { FactorySnapshot } from "@/lib/factory/types";
import { createClient } from "@/lib/supabase/server";

const EMPTY_SNAPSHOT: FactorySnapshot = {
  agents: [],
  tasksById: {},
  events: [],
  metrics: {
    productIdeas: 0,
    pendingReviews: 0,
    scheduledContent: 0,
    publishedListings: 0,
  },
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
  let snapshot = EMPTY_SNAPSHOT;

  if (ready) {
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        isAuthenticated = true;
        snapshot = await fetchFactorySnapshot(supabase, user.id);
      }
    } catch (err) {
      console.error("[dashboard] load failed", err);
    }
  }

  return (
    <DashboardView
      snapshot={snapshot}
      isAuthenticated={isAuthenticated}
      configReady={ready}
    />
  );
}
