import { WarRoomDashboard } from "@/components/warroom/war-room-dashboard";
import {
  fetchStrategyRecommendations,
  fetchWarRoomSignals,
  type WarRoomSignals,
} from "@/lib/ajax/warroom/service";
import { createClient } from "@/lib/supabase/server";

function configReady() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export default async function WarRoomPage() {
  const ready = configReady();
  let isAuthenticated = false;
  let initialRecommendations: Awaited<
    ReturnType<typeof fetchStrategyRecommendations>
  > = [];
  let signals: WarRoomSignals | null = null;

  if (ready) {
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        isAuthenticated = true;
        [initialRecommendations, signals] = await Promise.all([
          fetchStrategyRecommendations(supabase, user.id),
          fetchWarRoomSignals(supabase, user.id),
        ]);
      }
    } catch (err) {
      console.error("[war-room page] failed to load", err);
    }
  }

  return (
    <WarRoomDashboard
      initialRecommendations={initialRecommendations}
      signals={signals}
      isAuthenticated={isAuthenticated}
      configReady={ready}
    />
  );
}
