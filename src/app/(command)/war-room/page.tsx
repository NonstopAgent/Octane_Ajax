import { WarRoomDashboard } from "@/components/warroom/war-room-dashboard";
import { fetchStrategyRecommendations } from "@/lib/ajax/warroom/service";
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

  if (ready) {
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        isAuthenticated = true;
        initialRecommendations = await fetchStrategyRecommendations(
          supabase,
          user.id,
        );
      }
    } catch (err) {
      console.error("[war-room page] failed to load recommendations", err);
    }
  }

  return (
    <WarRoomDashboard
      initialRecommendations={initialRecommendations}
      isAuthenticated={isAuthenticated}
      configReady={ready}
    />
  );
}
