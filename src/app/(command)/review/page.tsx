import { ReviewDashboard } from "@/components/review/review-dashboard";
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

  if (ready) {
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        isAuthenticated = true;
        initialReviews = await fetchPendingReviews(supabase, user.id);
      }
    } catch (err) {
      console.error("[review page] failed to load queue", err);
    }
  }

  return (
    <ReviewDashboard
      initialReviews={initialReviews}
      isAuthenticated={isAuthenticated}
      configReady={ready}
    />
  );
}
