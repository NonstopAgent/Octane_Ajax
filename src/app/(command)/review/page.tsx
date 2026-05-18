import { ReviewDashboard } from "@/components/review/review-dashboard";
import { fetchListingsAwaitingGumroad } from "@/lib/review/publish-queries";
import { fetchPendingReviews } from "@/lib/review/queries";
import { createClient } from "@/lib/supabase/server";

function configReady() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export default async function ReviewPage() {
  const ready = configReady();
  let isAuthenticated = false;
  let initialReviews: Awaited<ReturnType<typeof fetchPendingReviews>> = [];
  let publishReadyListings: Awaited<
    ReturnType<typeof fetchListingsAwaitingGumroad>
  > = [];

  if (ready) {
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        isAuthenticated = true;
        initialReviews = await fetchPendingReviews(supabase, user.id);
        publishReadyListings = await fetchListingsAwaitingGumroad(
          supabase,
          user.id,
        );
      }
    } catch (err) {
      console.error("[review page] failed to load queue", err);
    }
  }

  return (
    <ReviewDashboard
      initialReviews={initialReviews}
      publishReadyListings={publishReadyListings}
      isAuthenticated={isAuthenticated}
      configReady={ready}
    />
  );
}
