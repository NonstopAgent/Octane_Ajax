import "server-only";

/**
 * Social auto-poster — publishes Pixel's staged promo packs to the linked
 * social accounts (via Ayrshare) on a capped cadence, from the hourly
 * autopilot. This is the traffic engine: Etsy SEO improves listings, but a
 * zero-sale shop needs outside visitors — pet content on
 * Pinterest/Instagram/TikTok is where they come from.
 *
 * DORMANT until AYRSHARE_API_KEY is set (same pattern as FAL video).
 * Anti-spam: at most MAX_POSTS_PER_DAY across all platforms, oldest staged
 * promo first, one post per pass.
 */
import {
  defaultPlatforms,
  isSocialConfigured,
  publishPost,
} from "@/lib/social/ayrshare";
import type { Json } from "@/lib/supabase/database.types";
import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";

const MAX_POSTS_PER_DAY = 2;
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
  caption: string | null;
  asset_url: string | null;
  metadata: {
    hashtags?: string[];
    productUrl?: string | null;
    postAttempts?: number;
  } | null;
};

export async function runSocialAutoPoster(
  supabase: Supabase,
  userId: string,
): Promise<AutoPostSummary> {
  const summary: AutoPostSummary = { posted: 0, errors: [] };

  if (!isSocialConfigured()) {
    summary.skipped = "not_configured";
    return summary;
  }

  // Daily cap across passes.
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: postedToday } = await supabase
    .from(TABLES.EVENTS)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("event_type", "social_posted")
    .gte("created_at", dayAgo);
  if ((postedToday ?? 0) >= MAX_POSTS_PER_DAY) {
    summary.skipped = "daily_cap";
    return summary;
  }

  // Oldest staged promo with real content.
  const { data: jobs } = await supabase
    .from(TABLES.CONTENT_JOBS)
    .select("id, caption, asset_url, metadata")
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

  const hashtags = (job.metadata?.hashtags ?? [])
    .map((h) => (h.startsWith("#") ? h : `#${h}`))
    .slice(0, 12)
    .join(" ");
  const link = job.metadata?.productUrl?.trim() || SHOP_URL;
  const post = [job.caption!.trim(), `🛒 ${link}`, hashtags]
    .filter(Boolean)
    .join("\n\n");

  const result = await publishPost({
    post,
    platforms: defaultPlatforms(),
    mediaUrls: [job.asset_url!],
  });

  if (result.ok) {
    await supabase
      .from(TABLES.CONTENT_JOBS)
      .update({
        status: "posted",
        metadata: {
          ...(job.metadata ?? {}),
          social: {
            ayrsharePostId: result.ayrsharePostId ?? null,
            posts: result.posts ?? [],
            postedAt: new Date().toISOString(),
          },
        } as Json,
      })
      .eq("id", job.id)
      .eq("user_id", userId);
    summary.posted += 1;
    await supabase.from(TABLES.EVENTS).insert({
      user_id: userId,
      event_type: "social_posted",
      message: `Pixel promo posted to ${defaultPlatforms().join(", ")}: "${job.caption!.slice(0, 70)}"`,
      agent_slug: "pixel",
      room: "media_studio",
      metadata: {
        contentJobId: job.id,
        posts: result.posts ?? [],
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
          lastPostError: result.error ?? "unknown",
        } as Json,
      })
      .eq("id", job.id)
      .eq("user_id", userId);
    summary.errors.push(result.error ?? "social post failed");
    await supabase.from(TABLES.EVENTS).insert({
      user_id: userId,
      event_type: "social_post_failed",
      message: `Social post failed (attempt ${(job.metadata?.postAttempts ?? 0) + 1}/${MAX_ATTEMPTS}): ${(result.error ?? "unknown").slice(0, 140)}`,
      agent_slug: "pixel",
      room: "media_studio",
      metadata: { contentJobId: job.id } as Json,
    });
  }

  return summary;
}
