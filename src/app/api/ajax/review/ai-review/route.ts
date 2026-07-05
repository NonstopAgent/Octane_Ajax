export const maxDuration = 60;

import { NextResponse } from "next/server";
import { getActiveBusiness } from "@/lib/businesses/active";
import { reviewListing } from "@/lib/ajax/reviewer/service";
import { approveReview, rejectReview } from "@/lib/review/service";
import { createClient } from "@/lib/supabase/server";
import { TABLES } from "@/lib/supabase/schema";

type ListingJoin = {
  title: string | null;
  description: string | null;
  price: number | null;
  mockup_url: string | null;
  product_ideas: { niche: string | null; seo_keywords: string[] | null } | null;
};

/** Fallback niche for the primary shop (GotchaDayGoods) when its row has none set,
 * so the reviewer still enforces pet-only brand fit on the first store. */
const PRIMARY_STORE_NICHE =
  "personalized gifts for pet owners — dogs, cats, and other pets — centered on adoption / gotcha-day anniversaries, pet memorials, pet birthdays ('barkday'), and pet-parent appreciation";

/** POST /api/ajax/review/ai-review — grade a pending listing against the Etsy
 * playbook. In autonomous mode (AI_REVIEWER_AUTONOMOUS=true or body.autonomous)
 * it also clears the gate: approve → advances the listing, reject → sends back. */
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

    // No hard gate on an LLM key: reviewListing falls back to a deterministic
    // grader, so the AI review always returns a verdict and clears the gate.
    const body = (await req.json().catch(() => ({}))) as {
      reviewId?: string;
      autonomous?: boolean;
    };
    if (!body.reviewId) {
      return NextResponse.json(
        { ok: false, error: "reviewId required" },
        { status: 400 },
      );
    }

    const { data: rev, error } = await supabase
      .from(TABLES.REVIEW_QUEUE)
      .select(
        `id, status, listing_id,
         product_listings ( title, description, price, mockup_url,
           product_ideas ( niche, seo_keywords ) )`,
      )
      .eq("id", body.reviewId)
      .eq("user_id", user.id)
      .single();

    if (error || !rev) {
      return NextResponse.json(
        { ok: false, error: "Review item not found." },
        { status: 404 },
      );
    }

    const listing = rev.product_listings as ListingJoin | null;
    if (!listing) {
      return NextResponse.json(
        { ok: false, error: "Linked listing not found." },
        { status: 404 },
      );
    }

    const active = await getActiveBusiness(supabase, user.id);
    const storeNiche =
      active?.niche?.trim() ||
      (active?.isPrimary ?? true ? PRIMARY_STORE_NICHE : null);
    const assessment = await reviewListing({
      title: listing.title ?? "",
      description: listing.description,
      price: listing.price,
      tags: listing.product_ideas?.seo_keywords ?? [],
      niche: listing.product_ideas?.niche ?? null,
      mockupUrls: listing.mockup_url ? [listing.mockup_url] : [],
      brand: active?.name ?? "GotchaDayGoods",
      storeNiche,
    });

    const autonomous =
      process.env.AI_REVIEWER_AUTONOMOUS === "true" || body.autonomous === true;

    let acted: "approved" | "rejected" | null = null;
    if (autonomous && rev.status === "pending") {
      try {
        if (assessment.verdict === "approve") {
          await approveReview(supabase, user.id, body.reviewId);
          acted = "approved";
        } else if (assessment.verdict === "reject") {
          await rejectReview(
            supabase,
            user.id,
            body.reviewId,
            assessment.reasons.join(" ") ||
              "AI reviewer: listing is below the quality bar.",
          );
          acted = "rejected";
        }
      } catch (actErr) {
        console.warn(
          "[ai-review] autonomous action skipped:",
          actErr instanceof Error ? actErr.message : actErr,
        );
      }
    }

    return NextResponse.json({
      ok: true,
      verdict: assessment.verdict,
      overallScore: assessment.overallScore,
      subscores: assessment.subscores,
      reasons: assessment.reasons,
      fixes: assessment.fixes,
      model: assessment.model,
      acted,
    });
  } catch (err) {
    console.error("[ai-review] error", err);
    return NextResponse.json(
      { ok: false, error: "AI review failed." },
      { status: 500 },
    );
  }
}
