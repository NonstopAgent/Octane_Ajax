/**
 * Autonomous review — one place that resolves a pending review, grades it (vision
 * / market-aware / heuristic), and optionally acts (approve or send back). Used by
 * BOTH the AI-review route and the shop-autopilot cron so the behaviour is
 * identical and post-approval (Etsy draft + video + marketing) always fires.
 *
 * On approve it returns the `postApproval` context; the CALLER runs runPostApproval
 * (route: via after(); cron: awaited) — this module never leaves it undone.
 */
import { approveReview, rejectReview, ReviewError } from "@/lib/review/service";
import { reviewListing } from "@/lib/ajax/reviewer/service";
import { matchMarketSignals } from "@/lib/ajax/product-brain/market-signals";
import { getActiveBusiness } from "@/lib/businesses/active";
import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";

/** Fallback pet niche for the primary shop when its row has no niche set. */
const PRIMARY_STORE_NICHE =
  "personalized gifts for pet owners — dogs, cats, and other pets — centered on adoption / gotcha-day anniversaries, pet memorials, pet birthdays ('barkday'), and pet-parent appreciation";

type ListingJoin = {
  title: string | null;
  description: string | null;
  price: number | null;
  mockup_url: string | null;
  product_ideas: { niche: string | null; seo_keywords: string[] | null } | null;
};

type PostApproval = Awaited<
  ReturnType<typeof approveReview>
>["postApproval"];

export type AutoReviewOutcome = {
  reviewId: string;
  assessment: Awaited<ReturnType<typeof reviewListing>>;
  acted: "approved" | "rejected" | null;
  postApproval: PostApproval | null;
};

/**
 * Grade the given (or oldest pending) review and, when `act` is true, clear the
 * gate: approve → advance (returns postApproval); reject/revise → send back.
 */
export async function autoReviewPending(
  supabase: Supabase,
  userId: string,
  opts: { reviewId?: string | null; act: boolean },
): Promise<AutoReviewOutcome | null> {
  const sel = `id, status, listing_id,
     product_listings ( title, description, price, mockup_url,
       product_ideas ( niche, seo_keywords ) )`;
  const base = supabase.from(TABLES.REVIEW_QUEUE).select(sel).eq("user_id", userId);
  const { data: rev } = opts.reviewId
    ? await base.eq("id", opts.reviewId).single()
    : await base
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

  if (!rev) return null;
  const listing = rev.product_listings as ListingJoin | null;
  if (!listing) return null;

  const active = await getActiveBusiness(supabase, userId);
  const storeNiche =
    active?.niche?.trim() ||
    (active?.isPrimary ?? true ? PRIMARY_STORE_NICHE : null);

  const { data: kwRows } = await supabase
    .from(TABLES.MARKET_KEYWORDS)
    .select("term, searches_per_month, competing_listings")
    .eq("user_id", userId)
    .eq("active", true)
    .limit(200);
  const market = matchMarketSignals(
    {
      title: listing.title ?? "",
      niche: listing.product_ideas?.niche ?? "",
      targetBuyer: "",
      keywords: listing.product_ideas?.seo_keywords ?? [],
    },
    (kwRows ?? []).map((r) => ({
      term: r.term ?? "",
      searchesPerMonth: r.searches_per_month ?? null,
      competingListings: r.competing_listings ?? null,
    })),
  );

  const assessment = await reviewListing({
    title: listing.title ?? "",
    description: listing.description,
    price: listing.price,
    tags: listing.product_ideas?.seo_keywords ?? [],
    niche: listing.product_ideas?.niche ?? null,
    mockupUrls: listing.mockup_url ? [listing.mockup_url] : [],
    brand: active?.name ?? "GotchaDayGoods",
    storeNiche,
    market,
  });

  let acted: "approved" | "rejected" | null = null;
  let postApproval: PostApproval | null = null;
  if (opts.act && rev.status === "pending") {
    try {
      if (assessment.verdict === "approve" || assessment.verdict === "revise") {
        // REVISE ≠ REJECT (2026-07-21): "revise" verdicts are cosmetic
        // title/tag suggestions on products that already cleared the art
        // gate and cost real money to build — treating them as rejections
        // killed 5 finished products in one day. Apply the parseable title
        // fix, record the rest as notes, and approve; the vision gate inside
        // approveReview still hard-blocks genuinely bad mockups (422 below).
        if (assessment.verdict === "revise") {
          const fixText = assessment.fixes.join(" ");
          const titleMatch = fixText.match(
            /title to:?\s*['"‘’“”]([^'"‘’“”]{10,140})['"‘’“”]/i,
          );
          if (titleMatch?.[1] && rev.listing_id) {
            await supabase
              .from(TABLES.LISTINGS)
              .update({ title: titleMatch[1].trim() })
              .eq("id", rev.listing_id)
              .eq("user_id", userId);
          }
          try {
            await supabase.from(TABLES.EVENTS).insert({
              user_id: userId,
              event_type: "review_revised_and_approved",
              message: `AI reviewer approved with revisions${titleMatch ? " (title applied)" : ""}: ${assessment.fixes.slice(0, 3).join(" ").slice(0, 280)}`,
              metadata: { reviewId: rev.id, listingId: rev.listing_id },
            });
          } catch {
            // the note is nice-to-have; the approval is not
          }
        }
        const r = await approveReview(supabase, userId, rev.id, {
          actor: "ai",
        });
        postApproval = r.postApproval;
        acted = "approved";
      } else {
        const reason =
          assessment.fixes.length > 0
            ? `AI reviewer: ${assessment.fixes.slice(0, 3).join(" ")}`
            : assessment.reasons.join(" ") ||
              "AI reviewer: below the quality bar.";
        await rejectReview(supabase, userId, rev.id, reason, { actor: "ai" });
        acted = "rejected";
      }
    } catch (err) {
      // A vision-gate rejection (422) means the PRODUCT is bad, not the
      // process. Leaving the review pending re-burned a Sage grade + vision
      // call every hourly pass forever AND blocked new production behind it
      // (2026-07-20: two mismatched Nova items wedged the cycle overnight).
      // Convert it into a real rejection so the cycle moves on.
      if (err instanceof ReviewError && err.statusCode === 422) {
        try {
          await rejectReview(
            supabase,
            userId,
            rev.id,
            `Auto-rejected by the vision gate — ${err.message.slice(0, 400)}`,
            { actor: "ai" },
          );
          acted = "rejected";
        } catch (rejectErr) {
          console.warn(
            "[auto-review] vision-fail auto-reject failed:",
            rejectErr instanceof Error ? rejectErr.message : rejectErr,
          );
        }
      } else {
        console.warn(
          "[auto-review] act failed:",
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  return { reviewId: rev.id as string, assessment, acted, postApproval };
}
