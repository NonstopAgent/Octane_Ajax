/**
 * Social performance — pure functions for the learning loop (no server-only
 * import so node:test can cover them).
 *
 * Flow: Ayrshare analytics land on published content_jobs (metadata.analytics)
 * → summarizePerformance() distills what's WORKING (per pillar, per product,
 * per hook style) into compact prose → Pixel's prompts bias future posts
 * toward proven patterns while keeping an exploration share.
 */

export type ExtractedMetrics = {
  impressions: number;
  likes: number;
  comments: number;
  saves: number;
  clicks: number;
};

export type AnalyzedPost = {
  caption: string | null;
  pillar: string | null;
  listingTitle?: string | null;
  platforms: string[];
  metrics: ExtractedMetrics;
  score: number;
};

const NUM_KEYS: Record<keyof ExtractedMetrics, string[]> = {
  impressions: ["impressions", "views", "reach", "impressionCount", "playCount", "videoViews"],
  likes: ["likes", "likeCount", "favorites", "diggCount", "reactions"],
  comments: ["comments", "commentCount", "commentsCount"],
  saves: ["saves", "saveCount", "pinClicks", "bookmarkCount", "shares", "shareCount"],
  clicks: ["clicks", "clickCount", "outboundClicks", "linkClicks", "websiteClicks"],
};

function deepNumber(obj: unknown, key: string): number {
  if (obj == null || typeof obj !== "object") return 0;
  const record = obj as Record<string, unknown>;
  if (typeof record[key] === "number") return record[key];
  for (const v of Object.values(record)) {
    if (v && typeof v === "object") {
      const found = deepNumber(v, key);
      if (found > 0) return found;
    }
  }
  return 0;
}

/** Pull common engagement counts out of Ayrshare's per-platform payloads
 * (shapes differ per network — search nested objects defensively). */
export function extractMetrics(platformPayload: unknown): ExtractedMetrics {
  const out: ExtractedMetrics = {
    impressions: 0,
    likes: 0,
    comments: 0,
    saves: 0,
    clicks: 0,
  };
  for (const [metric, aliases] of Object.entries(NUM_KEYS) as [
    keyof ExtractedMetrics,
    string[],
  ][]) {
    for (const alias of aliases) {
      const v = deepNumber(platformPayload, alias);
      if (v > 0) {
        out[metric] = Math.max(out[metric], v);
      }
    }
  }
  return out;
}

/** One engagement number: saves/clicks (buyer intent) outweigh likes. */
export function scoreEngagement(m: ExtractedMetrics): number {
  return (
    m.impressions * 0.001 + m.likes + m.comments * 2 + m.saves * 3 + m.clicks * 3
  );
}

const avg = (ns: number[]) =>
  ns.length === 0 ? 0 : ns.reduce((a, b) => a + b, 0) / ns.length;

/**
 * Distill analyzed posts into compact prose for Pixel's prompt. Returns null
 * when there isn't enough data to say anything useful (< 5 scored posts).
 */
export function summarizePerformance(posts: AnalyzedPost[]): string | null {
  const scored = posts.filter((p) => p.caption?.trim());
  if (scored.length < 5) return null;

  const byScore = [...scored].sort((a, b) => b.score - a.score);
  const top = byScore.slice(0, 3);
  const flop = byScore[byScore.length - 1];

  const pillars = new Map<string, number[]>();
  for (const p of scored) {
    const key = p.pillar?.trim().toLowerCase() || "unknown";
    pillars.set(key, [...(pillars.get(key) ?? []), p.score]);
  }
  const pillarLine = [...pillars.entries()]
    .map(([k, v]) => `${k}: avg ${avg(v).toFixed(1)} (${v.length} posts)`)
    .join(" · ");

  const lines = [
    `Based on ${scored.length} measured posts:`,
    `Pillar performance — ${pillarLine}.`,
    "Top performers (write MORE like these):",
    ...top.map(
      (p, i) =>
        `${i + 1}. [${p.pillar ?? "?"} | score ${p.score.toFixed(1)} | ${p.metrics.saves} saves, ${p.metrics.clicks} clicks] "${(p.caption ?? "").slice(0, 90)}"`,
    ),
  ];
  if (flop && flop.score === 0 && top[0] && top[0].score > 0) {
    lines.push(
      `Weakest (avoid this pattern): "${(flop.caption ?? "").slice(0, 80)}"`,
    );
  }
  lines.push(
    "Bias ~80% of new copy toward the winning pillar/hook styles; keep ~20% exploring new angles.",
  );
  return lines.join("\n").slice(0, 1500);
}
