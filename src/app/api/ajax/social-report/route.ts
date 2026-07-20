/**
 * GET /api/ajax/social-report — live social scoreboard from Ayrshare.
 *
 * Post-cleanup rebaseline (2026-07-19): 46 corrupted-product posts were
 * purged, so historical briefs measure deleted content. This pulls the
 * SURVIVING posts from Ayrshare history, fetches fresh analytics for the
 * most recent ones, and aggregates per platform + per post so the operator
 * can see what's working and what needs fixing.
 */
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { socialApiKey } from "@/lib/social/ayrshare";
import { extractMetrics, scoreEngagement } from "@/lib/social/performance";

const HISTORY_URL = "https://api.ayrshare.com/api/history";
const ANALYTICS_URL =
  process.env.AYRSHARE_ANALYTICS_URL?.trim() ||
  "https://api.ayrshare.com/api/analytics/post";

export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized." },
        { status: 401 },
      );
    }
    const key = socialApiKey();
    if (!key) {
      return NextResponse.json(
        { ok: false, error: "AYRSHARE_API_KEY not configured." },
        { status: 500 },
      );
    }
    const headers = {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    };
    const url = new URL(req.url);
    const maxFetch = Math.min(Number(url.searchParams.get("max") ?? 20), 30);

    const histRes = await fetch(`${HISTORY_URL}?limit=150`, { headers });
    if (!histRes.ok) {
      throw new Error(`Ayrshare history failed (${histRes.status}).`);
    }
    const hist = (await histRes.json()) as {
      history?: {
        id?: string;
        post?: string;
        platforms?: string[];
        created?: string;
        status?: string;
        mediaUrls?: string[];
      }[];
    };
    const live = (hist.history ?? []).filter(
      (p) => p.id && p.status !== "deleted",
    );
    // Newest first, measure the most recent `maxFetch`.
    const toMeasure = [...live]
      .sort((a, b) => (b.created ?? "").localeCompare(a.created ?? ""))
      .slice(0, maxFetch);

    const perPlatform: Record<
      string,
      {
        posts: number;
        impressions: number;
        likes: number;
        comments: number;
        saves: number;
        clicks: number;
      }
    > = {};
    const postRows: {
      created?: string;
      platforms: string[];
      video: boolean;
      score: number;
      impressions: number;
      likes: number;
      saves: number;
      clicks: number;
      snippet: string;
    }[] = [];

    for (const p of toMeasure) {
      let payload: Record<string, unknown> | null = null;
      try {
        const res = await fetch(ANALYTICS_URL, {
          method: "POST",
          headers,
          body: JSON.stringify({ id: p.id }),
          signal: AbortSignal.timeout(15_000),
        });
        if (res.ok) payload = (await res.json()) as Record<string, unknown>;
      } catch {
        payload = null;
      }
      if (!payload) continue;

      const platforms = p.platforms ?? [];
      const isVideo = (p.mediaUrls ?? []).some((m) => /\.mp4|video/i.test(m));
      let totalScore = 0;
      const totals = { impressions: 0, likes: 0, saves: 0, clicks: 0 };
      for (const platform of platforms) {
        const platPayload =
          (payload as Record<string, unknown>)[platform] ?? payload;
        const m = extractMetrics(platPayload);
        totalScore += scoreEngagement(m);
        totals.impressions += m.impressions;
        totals.likes += m.likes;
        totals.saves += m.saves;
        totals.clicks += m.clicks;
        const agg = (perPlatform[platform] ??= {
          posts: 0,
          impressions: 0,
          likes: 0,
          comments: 0,
          saves: 0,
          clicks: 0,
        });
        agg.posts += 1;
        agg.impressions += m.impressions;
        agg.likes += m.likes;
        agg.comments += m.comments;
        agg.saves += m.saves;
        agg.clicks += m.clicks;
      }
      postRows.push({
        created: p.created,
        platforms,
        video: isVideo,
        score: Number(totalScore.toFixed(1)),
        ...totals,
        snippet: (p.post ?? "").slice(0, 60),
      });
      await new Promise((r) => setTimeout(r, 250));
    }

    const byScore = [...postRows].sort((a, b) => b.score - a.score);
    const videoRows = postRows.filter((r) => r.video);
    const photoRows = postRows.filter((r) => !r.video);
    const avg = (ns: number[]) =>
      ns.length ? Number((ns.reduce((a, b) => a + b, 0) / ns.length).toFixed(1)) : 0;

    return NextResponse.json({
      ok: true,
      livePosts: live.length,
      measured: postRows.length,
      perPlatform,
      avgScoreVideo: avg(videoRows.map((r) => r.score)),
      avgScorePhoto: avg(photoRows.map((r) => r.score)),
      top: byScore.slice(0, 5),
      zeroEngagement: postRows.filter((r) => r.score === 0).length,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "failed" },
      { status: 500 },
    );
  }
}
