import { FactoryDashboard } from "@/components/factory/factory-dashboard";
import { fetchFactorySnapshot } from "@/lib/factory/queries";
import { createClient } from "@/lib/supabase/server";

function configReady() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export default async function FactoryPage() {
  const ready = configReady();
  let isAuthenticated = false;
  let initialSnapshot = null;

  if (ready) {
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        isAuthenticated = true;
        const snapshot = await fetchFactorySnapshot(supabase, user.id);
        initialSnapshot = snapshot;
      }
    } catch (err) {
      console.error("[factory page] failed to load snapshot", err);
    }
  }

  return (
    <FactoryDashboard
      initialSnapshot={initialSnapshot}
      isAuthenticated={isAuthenticated}
      configReady={ready}
    />
  );
}
