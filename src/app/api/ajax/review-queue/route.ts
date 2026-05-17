import { NextResponse } from "next/server";
import { fetchPendingReviews } from "@/lib/review/queries";
import { createClient } from "@/lib/supabase/server";

/** GET /api/ajax/review-queue — pending reviews with listing + idea. */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const reviews = await fetchPendingReviews(supabase, user.id);
    return NextResponse.json({ ok: true, reviews });
  } catch (err) {
    console.error("[review-queue]", err);
    return NextResponse.json(
      { ok: false, error: "Failed to load review queue." },
      { status: 500 },
    );
  }
}
