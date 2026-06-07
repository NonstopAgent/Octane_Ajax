import { FactorySweatshop } from "@/components/factory/factory-sweatshop";
import { fetchSweatshopSnapshot } from "@/lib/factory/queries";
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
  let initialEvents: Awaited<
    ReturnType<typeof fetchSweatshopSnapshot>
  >["events"] = [];
  let initialOrders: Awaited<
    ReturnType<typeof fetchSweatshopSnapshot>
  >["orders"] = [];
  let initialTikTokQueue: Awaited<
    ReturnType<typeof fetchSweatshopSnapshot>
  >["tiktokQueue"] = [];

  if (ready) {
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        isAuthenticated = true;
        const snapshot = await fetchSweatshopSnapshot(supabase, user.id);
        initialEvents = snapshot.events;
        initialOrders = snapshot.orders;
        initialTikTokQueue = snapshot.tiktokQueue;
      }
    } catch (err) {
      console.error("[factory page] failed to load sweatshop snapshot", err);
    }
  }

  return (
    <FactorySweatshop
      isAuthenticated={isAuthenticated}
      configReady={ready}
      initialEvents={initialEvents}
      initialOrders={initialOrders}
      initialTikTokQueue={initialTikTokQueue}
    />
  );
}
