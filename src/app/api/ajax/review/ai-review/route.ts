export const maxDuration = 60;

import { after, NextResponse } from "next/server";
import { autoReviewPending } from "@/lib/review/auto-review";
import { runPostApproval } from "@/lib/review/service";
import { createClient } from "@/lib/supabase/server";
import { requireOperator } from "@/lib/auth/operator";

/**
 * POST /api/ajax/review/ai-review
 * - { reviewId }   → grade that review; { } → grade the oldest pending one.
 * - { autonomous } (or AI_REVIEWER_AUTONOMOUS=true) → also ACT: approve advances
 *   the listing (Etsy draft + video + marketing run in the background) or send back.
 * Always returns a verdict (vision → text LLM → deterministic heuristic).
 */
export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    // Operator-only (2026-07-25 audit, H10): signed-in is not authorized —
    // this surface mutates the ONE live shop on process-wide credentials.
    const operatorCheck = requireOperator(user);
    if (!operatorCheck.ok) {
      return NextResponse.json(
        { ok: false, error: operatorCheck.error },
        { status: operatorCheck.status },
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      reviewId?: string;
      autonomous?: boolean;
    };
    // QUIET WINDOW (2026-07-26): an autonomous approve publishes a new
    // listing — during the freeze this route grades only, never acts. The
    // browser's 18s auto-review poll hits this hourly-equivalent, so gating
    // here (not just in the cron) matters.
    const { areListingWritesFrozen } = await import(
      "@/lib/ajax/listing-freeze"
    );
    const autonomous =
      !areListingWritesFrozen() &&
      (process.env.AI_REVIEWER_AUTONOMOUS === "true" ||
        body.autonomous === true);

    const out = await autoReviewPending(supabase, user.id, {
      reviewId: body.reviewId ?? null,
      act: autonomous,
    });
    if (!out) {
      return NextResponse.json(
        { ok: false, error: "No pending review found." },
        { status: 404 },
      );
    }

    // Heavy post-approval (Etsy draft + video render + marketing) in the background.
    if (out.postApproval) {
      const ctx = out.postApproval;
      after(() => runPostApproval(ctx));
    }

    return NextResponse.json({
      ok: true,
      verdict: out.assessment.verdict,
      overallScore: out.assessment.overallScore,
      subscores: out.assessment.subscores,
      reasons: out.assessment.reasons,
      fixes: out.assessment.fixes,
      model: out.assessment.model,
      acted: out.acted,
    });
  } catch (err) {
    console.error("[ai-review] error", err);
    return NextResponse.json(
      { ok: false, error: "AI review failed." },
      { status: 500 },
    );
  }
}
