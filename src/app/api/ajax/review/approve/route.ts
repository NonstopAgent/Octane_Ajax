import { after, NextResponse } from "next/server";
import { approveReview, runPostApproval, ReviewError } from "@/lib/review/service";
import { createClient } from "@/lib/supabase/server";

/** POST /api/ajax/review/approve — body: { reviewId: string } */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as { reviewId?: string };
    if (!body.reviewId) {
      return NextResponse.json(
        { ok: false, error: "reviewId is required." },
        { status: 400 },
      );
    }

    const { postApproval, ...result } = await approveReview(
      supabase,
      user.id,
      body.reviewId,
    );
    // Etsy draft publish + Pixel marketing run after the response is sent so the
    // operator's Approve click returns immediately instead of waiting 10–30s.
    after(() => runPostApproval(postApproval));
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ReviewError) {
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message },
        { status: err.statusCode },
      );
    }

    console.error("[review/approve]", err);
    return NextResponse.json(
      { ok: false, error: "Failed to approve listing." },
      { status: 500 },
    );
  }
}
