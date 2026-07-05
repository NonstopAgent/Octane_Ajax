export const maxDuration = 60;

import { after, NextResponse } from "next/server";
import { autoReviewPending } from "@/lib/review/auto-review";
import { runPostApproval } from "@/lib/review/service";
import { createClient } from "@/lib/supabase/server";

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

    const body = (await req.json().catch(() => ({}))) as {
      reviewId?: string;
      autonomous?: boolean;
    };
    const autonomous =
      process.env.AI_REVIEWER_AUTONOMOUS === "true" || body.autonomous === true;

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
