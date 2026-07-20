import "server-only";

/**
 * Social auto-poster — publishes Pixel's staged promo packs to the linked
 * social accounts (via Ayrshare) on a capped cadence, from the hourly
 * autopilot. This is the traffic engine: Etsy SEO improves listings, but a
 * zero-sale shop needs outside visitors — pet content on
 * Pinterest/Instagram/TikTok is where they come from.
 *
 * DORMANT until AYRSHARE_API_KEY is set (same pattern as FAL video).
 * Anti-spam: PER-PLATFORM daily caps (operator wants 5-7 posts/day —
 * Pinterest thrives on that volume, but feed platforms like Instagram and
 * TikTok read 6 identical daily posts as spam, so they stay at 2). One job
 * per pass, oldest staged promo first; the hourly cron spreads posts out.
 */
import {
  defaultPlatforms,
  isSocialConfigured,
  publishPost,
} from "@/lib/social/ayrshare";
import { duePlatforms } from "@/lib/social/cadence";
import type { Json } from "@/lib/supabase/database.types";
import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";

const MAX_ATTEMPTS = 3;

/** Buyer-facing shop link fallback (Share & Save — commission-friendly). */
const SHOP_URL =
  process.env.SHOP_SHARE_URL?.trim() || "https://gotchadaygoods.etsy.com";

export type AutoPostSummary = {
  posted: number;
  skipped?: string;
  errors: string[];
};

type StagedJob = {
  id: string;
  listing_id: string | null;
  caption: string | null;
  asset_url: string | null;
  metadata: {
    hashtags?: string[];
    productUrl?: string | null;
    postAttempts?: number;
  } | null;
};

/**
 * Every platform here is video-first in 2026 — Reels, Pins and TikToks with
 * motion get reach; a single square catalog photo gets buried. So the poster
 * sends the listing's rendered LIFESTYLE video to every due platform and only
 * falls back to the static mockup when no video exists yet.
 *
 * Preference order: the 9:16 social clip (vertical, built for feeds) over the
 * 1:1 listing clip. TikTok additionally rejects PNGs and square images, so it
 * is skipped entirely on a photo-only pass rather than burning retries on a
 * guaranteed rejection.
 */
async function findPromoVideo(
  supabase: Supabase,
  userId: string,
  listingId: string | null,
): Promise<{ url: string; vertical: boolean } | null> {
  if (!listingId) return null;
  const { data: listingRow } = await supabase
    .from(TABLES.LISTINGS)
    .select("gumroad_product_id")
    .eq("id", listingId)
    .eq("user_id", userId)
    .maybeSingle();
  const etsyId = String(listingRow?.gumroad_product_id ?? "");
  if (!/^\d+$/.test(etsyId)) return null;
  const { data: vids } = await supabase
    .from(TABLES.VIDEO_JOBS)
    .select("video_url, kind")
    .eq("user_id", userId)
    .eq("etsy_listing_id", etsyId)
    .eq("status", "done")
    .not("video_url", "is", null)
    .order("updated_at", { ascending: false })
    .limit(5);
  const rows = (vids ?? []).filter((v) =>
    (v.video_url ?? "").trim().startsWith("https://"),
  );
  const social = rows.find((v) => v.kind === "social");
  const chosen = social ?? rows[0];
  if (!chosen?.video_url) return null;
  return { url: chosen.video_url.trim(), vertical: chosen.kind === "social" };
}

export async function runSocialAutoPoster(
  supabase: Supabase,
  userId: string,
): Promise<AutoPostSummary> {
  const summary: AutoPostSummary = { posted: 0, errors: [] };

  if (!isSocialConfigured()) {
    summary.skipped = "not_configured";
    return summary;
  }

  // Per-platform daily budgets across passes. Legacy events without a
  // platforms list count against every default platform (conservative).
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: postedEvents } = await supabase
    .from(TABLES.EVENTS)
    .select("metadata")
    .eq("user_id", userId)
    .eq("event_type", "social_posted")
    .gte("created_at", dayAgo);
  const counts: Record<string, number> = {};
  for (const row of postedEvents ?? []) {
    const meta = row.metadata as {
      platforms?: string[];
      posts?: { platform?: string }[];
    } | null;
    const posted =
      meta?.platforms ??
      meta?.posts?.map((p) => p.platform ?? "").filter(Boolean) ??
      defaultPlatforms();
    for (const p of posted) {
      const key = p.toLowerCase();
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  const targets = duePlatforms(counts, defaultPlatforms());
  if (targets.length === 0) {
    summary.skipped = "daily_cap";
    return summary;
  }

  // Oldest staged promo with real content.
  const { data: jobs } = await supabase
    .from(TABLES.CONTENT_JOBS)
    .select("id, listing_id, caption, asset_url, metadata")
    .eq("user_id", userId)
    .eq("status", "scheduled")
    .order("created_at", { ascending: true })
    .limit(5);

  const job = ((jobs ?? []) as StagedJob[]).find(
    (j) =>
      j.caption?.trim() &&
      j.asset_url?.trim() &&
      j.asset_url.startsWith("https://") &&
      (j.metadata?.postAttempts ?? 0) < MAX_ATTEMPTS,
  );
  if (!job) {
    summary.skipped = "nothing_staged";
    return summary;
  }

  // Video-first: one lifestyle clip to EVERY due platform (Reels/Pins/TikToks
  // with motion get reach; a lone square catalog photo does not). The static
  // mockup is a fallback, not the plan.
  const promoVideo = await findPromoVideo(supabase, userId, job.listing_id);
  // Video-first platforms never receive photo-only posts. TikTok rejects
  // them outright; Instagram accepts them but the 2026-07-19 rebaseline
  // showed photo posts scoring ZERO engagement across the board while every
  // top performer was video — an IG photo slot is a wasted slot.
  const photoTargets = targets.filter(
    (p) => p !== "tiktok" && p !== "instagram",
  );

  if (!promoVideo && photoTargets.length === 0) {
    // Only TikTok was due and this listing has no video yet — leave the job
    // staged (untouched) for a pass where a photo platform has budget.
    summary.skipped = "tiktok_no_video";
    return summary;
  }

  // Instagram HARD-REJECTS posts over 10 hashtags ("Too many hashtags") —
  // 12 was zeroing every IG send. 8 leaves margin for platform quirks.
  const hashtags = (job.metadata?.hashtags ?? [])
    .map((h) => (h.startsWith("#") ? h : `#${h}`))
    .slice(0, 8)
    .join(" ");
  const link = job.metadata?.productUrl?.trim() || SHOP_URL;
  const post = [job.caption!.trim(), `🛒 ${link}`, hashtags]
    .filter(Boolean)
    .join("\n\n");

  const attempts: { platform: string; ok: boolean; error?: string }[] = [];
  const sendTargets = promoVideo ? targets : photoTargets;
  const mediaKind: "video" | "photo" = promoVideo ? "video" : "photo";
  const result = await publishPost({
    post,
    platforms: sendTargets,
    mediaUrls: [promoVideo ? promoVideo.url : job.asset_url!],
    isVideo: Boolean(promoVideo),
    // Pinterest hard-requires a thumbnail on video pins — the job's static
    // mockup is exactly that. Without it Ayrshare rejects the pin outright.
    pinterestThumbnailUrl: promoVideo ? job.asset_url : null,
    // TikTok publishes DIRECTLY (operator call, 2026-07-15): the draft
    // workflow required a daily manual step in the TikTok app that wasn't
    // happening, so clips sat unpublished. Flip SOCIAL_TIKTOK_DRAFTS=true to
    // return to drafts if trending-sound curation becomes worth the time.
    tiktokDraft: process.env.SOCIAL_TIKTOK_DRAFTS === "true",
  });
  attempts.push(
    ...sendTargets.map((p) => ({
      platform: p,
      ok: result.ok,
      error: result.error ?? undefined,
    })),
  );

  if (!promoVideo) {
    // Never silently ship the weak version — a static square photo is the
    // low-reach path, and the operator should see WHY it happened.
    await supabase.from(TABLES.EVENTS).insert({
      user_id: userId,
      event_type: "social_static_fallback",
      message:
        "Posted a static product photo (low reach): this listing has no finished video yet, so there was no clip to post.",
      agent_slug: "pixel",
      room: "media_studio",
      metadata: { contentJobId: job.id, listingId: job.listing_id } as Json,
    });
  }

  const anyOk = result.ok;
  const combinedError = result.error || null;

  if (anyOk) {
    // Platforms that actually accepted the post (partial success counts —
    // the job is DONE either way; retrying would duplicate the successes).
    const landed =
      result.posts && result.posts.length > 0
        ? result.posts.map((p) => p.platform).filter(Boolean)
        : sendTargets;
    // NOTE: content_jobs.status check constraint allows 'published' (not
    // 'posted') — using an invalid value would silently fail the update and
    // the same job would repost every hour.
    await supabase
      .from(TABLES.CONTENT_JOBS)
      .update({
        status: "published",
        metadata: {
          ...(job.metadata ?? {}),
          social: {
            ayrsharePostId: result.ayrsharePostId ?? null,
            posts: result.posts ?? [],
            partialErrors: combinedError,
            mediaKind,
            videoUrl: promoVideo?.url ?? null,
            vertical: promoVideo?.vertical ?? false,
            postedAt: new Date().toISOString(),
          },
        } as Json,
      })
      .eq("id", job.id)
      .eq("user_id", userId);
    summary.posted += 1;
    if (combinedError) summary.errors.push(`partial: ${combinedError}`);
    await supabase.from(TABLES.EVENTS).insert({
      user_id: userId,
      event_type: "social_posted",
      message: `Pixel promo posted to ${landed.join(", ")} as ${mediaKind === "video" ? `${promoVideo?.vertical ? "a vertical 9:16" : "a square"} lifestyle video` : "a static photo (no video rendered yet)"}: "${job.caption!.slice(0, 70)}"${combinedError ? ` (skipped: ${combinedError.slice(0, 80)})` : ""}`,
      agent_slug: "pixel",
      room: "media_studio",
      metadata: {
        contentJobId: job.id,
        platforms: landed,
        posts: result.posts ?? [],
        mediaKind,
        attempts,
      } as unknown as Json,
    });
  } else {
    // Track attempts; give up after MAX_ATTEMPTS so a bad job can't wedge the queue.
    await supabase
      .from(TABLES.CONTENT_JOBS)
      .update({
        metadata: {
          ...(job.metadata ?? {}),
          postAttempts: (job.metadata?.postAttempts ?? 0) + 1,
          lastPostError: combinedError ?? "unknown",
        } as Json,
      })
      .eq("id", job.id)
      .eq("user_id", userId);
    summary.errors.push(combinedError ?? "social post failed");
    await supabase.from(TABLES.EVENTS).insert({
      user_id: userId,
      event_type: "social_post_failed",
      message: `Social post failed (attempt ${(job.metadata?.postAttempts ?? 0) + 1}/${MAX_ATTEMPTS}): ${(combinedError ?? "unknown").slice(0, 140)}`,
      agent_slug: "pixel",
      room: "media_studio",
      metadata: { contentJobId: job.id, attempts } as unknown as Json,
    });
  }

  return summary;
}
