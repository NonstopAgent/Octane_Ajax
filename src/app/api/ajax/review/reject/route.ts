import { NextResponse } from "next/server";
import { rejectReview, ReviewError } from "@/lib/review/service";
import { createClient } from "@/lib/supabase/server";

/** POST /api/ajax/review/reject — body: { reviewId: string, reason: string } */
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

    const body = (await request.json()) as {
      reviewId?: string;
      reason?: string;
    };

    if (!body.reviewId) {
      return NextResponse.json(
        { ok: false, error: "reviewId is required." },
        { status: 400 },
      );
    }

    const result = await rejectReview(
      supabase,
      user.id,
      body.reviewId,
      body.reason ?? "",
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ReviewError) {
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message },
        { status: err.statusCode },
      );
    }

    console.error("[review/reject]", err);
    return NextResponse.json(
      { ok: false, error: "Failed to reject listing." },
      { status: 500 },
    );
  }
}
