import "server-only";

/**
 * Social analytics — the LEARNING half of the loop. Pulls per-post metrics
 * from Ayrshare (Business plan) for published promos, scores them, and keeps
 * a daily performance brief that Pixel injects into its prompts.
 *
 * DORMANT without AYRSHARE_API_KEY. Cheap by design: ≤4 analytics fetches per
 * hourly pass, each post measured ~12h after publishing (metrics need time),
 * refreshed once after 48h, then left alone.
 */
import { socialApiKey } from "@/lib/social/ayrshare";
import {
  extractMetrics,
  scoreEngagement,
  summarizePerformance,
  type AnalyzedPost,
} from "@/lib/social/performance";
import type { Json } from "@/lib/supabase/database.types";
import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";

const ANALYTICS_URL =
  process.env.AYRSHARE_ANALYTICS_URL?.trim() ||
  "https://api.ayrshare.com/api/analytics/post";
const PERF_EVENT = "social_performance_brief";
const PERF_CACHE_HOURS = 20;
const MIN_POST_AGE_HOURS = 12;
const MAX_FETCHES_PER_PASS = 4;

type PostedJobRow = {
  id: string;
  caption: string | null;
  metadata: {
    pillar?: string | null;
    social?: {
      ayrsharePostId?: string | null;
      postedAt?: string | null;
    } | null;
    analytics?: { fetchedAt?: string } | null;
  } | null;
};

/** Fetch raw analytics for one Ayrshare post id. Never throws. */
async function fetchPostAnalytics(
  ayrsharePostId: string,
): Promise<Record<string, unknown> | null> {
  const key = socialApiKey();
  if (!key) return null;
  try {
    const res = await fetch(ANALYTICS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: ayrsharePostId }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Measure recently posted promos (≤4 per pass) and store metrics + score on
 * the job. Safe to call every hour; skips everything already measured.
 */
export async function runSocialAnalytics(
  supabase: Supabase,
  userId: string,
): Promise<{ measured: number }> {
  if (!socialApiKey()) return { measured: 0 };

  const { data: jobs } = await supabase
    .from(TABLES.CONTENT_JOBS)
    .select("id, caption, metadata")
    .eq("user_id", userId)
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .limit(40);

  const now = Date.now();
  const due = ((jobs ?? []) as PostedJobRow[])
    .filter((j) => {
      const postId = j.metadata?.social?.ayrsharePostId;
      if (!postId) return false;
      const postedAt = Date.parse(j.metadata?.social?.postedAt ?? "");
      if (
        Number.isFinite(postedAt) &&
        now - postedAt < MIN_POST_AGE_HOURS * 3_600_000
      ) {
        return false; // too fresh — metrics haven't accumulated yet
      }
      const fetchedAt = Date.parse(j.metadata?.analytics?.fetchedAt ?? "");
      if (!Number.isFinite(fetchedAt)) return true; // never measured
      // Re-measure once after 48h, then leave it alone.
      return now - fetchedAt > 48 * 3_600_000 && now - fetchedAt < 96 * 3_600_000;
    })
    .slice(0, MAX_FETCHES_PER_PASS);

  let measured = 0;
  for (const job of due) {
    const postId = job.metadata?.social?.ayrsharePostId ?? "";
    const raw = await fetchPostAnalytics(postId);
    if (!raw) continue;
    const platforms: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v && typeof v === "object" && !["id", "status"].includes(k)) {
        platforms[k] = v;
      }
    }
    const metrics = extractMetrics(platforms);
    const score = scoreEngagement(metrics);
    await supabase
      .from(TABLES.CONTENT_JOBS)
      .update({
        metadata: {
          ...(job.metadata ?? {}),
          analytics: {
            fetchedAt: new Date().toISOString(),
            metrics,
            score,
            platforms: Object.keys(platforms),
            raw: platforms,
          },
        } as unknown as Json,
      })
      .eq("id", job.id)
      .eq("user_id", userId);
    measured += 1;
    await new Promise((r) => setTimeout(r, 300));
  }
  return { measured };
}

type MeasuredJobRow = PostedJobRow & {
  metadata: PostedJobRow["metadata"] & {
    analytics?: {
      fetchedAt?: string;
      metrics?: AnalyzedPost["metrics"];
      score?: number;
      platforms?: string[];
    } | null;
  };
};

/**
 * Daily performance brief for Pixel's prompts (cached ~20h in factory_events,
 * same pattern as the trend brief). Null until ≥5 measured posts exist.
 */
export async function fetchPerformanceNotes(
  supabase: Supabase,
  userId: string,
): Promise<string | null> {
  try {
    const since = new Date(
      Date.now() - PERF_CACHE_HOURS * 3_600_000,
    ).toISOString();
    const { data: cached } = await supabase
      .from(TABLES.EVENTS)
      .select("metadata")
      .eq("user_id", userId)
      .eq("event_type", PERF_EVENT)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1);
    const cachedNotes = (
      cached?.[0]?.metadata as { notes?: string } | null
    )?.notes;
    if (cachedNotes?.trim()) return cachedNotes;

    const { data: jobs } = await supabase
      .from(TABLES.CONTENT_JOBS)
      .select("id, caption, metadata")
      .eq("user_id", userId)
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .limit(60);

    const analyzed: AnalyzedPost[] = ((jobs ?? []) as MeasuredJobRow[])
      .filter((j) => j.metadata?.analytics?.metrics)
      .map((j) => ({
        caption: j.caption,
        pillar: j.metadata?.pillar ?? null,
        platforms: j.metadata?.analytics?.platforms ?? [],
        metrics: j.metadata!.analytics!.metrics!,
        score: j.metadata?.analytics?.score ?? 0,
      }));

    const notes = summarizePerformance(analyzed);
    if (!notes) return null;

    await supabase.from(TABLES.EVENTS).insert({
      user_id: userId,
      event_type: PERF_EVENT,
      message: `Pixel learning loop: refreshed performance brief from ${analyzed.length} measured post(s).`,
      agent_slug: "pixel",
      room: "media_studio",
      metadata: { notes, measured: analyzed.length } as unknown as Json,
    });
    return notes;
  } catch {
    return null;
  }
}
