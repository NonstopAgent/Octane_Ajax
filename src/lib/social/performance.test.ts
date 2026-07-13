import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractMetrics,
  scoreEngagement,
  summarizePerformance,
  type AnalyzedPost,
} from "@/lib/social/performance";

describe("extractMetrics", () => {
  it("finds counts across Ayrshare's varied nested shapes", () => {
    const payload = {
      pinterest: { analytics: { impressions: 120, saves: 7, pinClicks: 4, outboundClicks: 3 } },
      instagram: { likeCount: 15, commentsCount: 2, reach: 300 },
      tiktok: { analytics: { playCount: 900, diggCount: 30, shareCount: 5 } },
    };
    const m = extractMetrics(payload);
    assert.equal(m.impressions, 900); // max across platforms
    assert.equal(m.likes, 30);
    assert.equal(m.comments, 2);
    assert.ok(m.saves >= 7);
    assert.ok(m.clicks >= 3);
  });

  it("returns zeros for empty/unknown payloads", () => {
    const m = extractMetrics({ status: "success" });
    assert.deepEqual(m, { impressions: 0, likes: 0, comments: 0, saves: 0, clicks: 0 });
  });
});

describe("scoreEngagement", () => {
  it("weights buyer-intent actions above likes", () => {
    const saves = scoreEngagement({ impressions: 0, likes: 0, comments: 0, saves: 10, clicks: 0 });
    const likes = scoreEngagement({ impressions: 0, likes: 10, comments: 0, saves: 0, clicks: 0 });
    assert.ok(saves > likes);
  });
});

describe("summarizePerformance", () => {
  const post = (pillar: string, score: number, caption: string): AnalyzedPost => ({
    caption,
    pillar,
    platforms: ["pinterest"],
    metrics: { impressions: score * 100, likes: score, comments: 0, saves: score, clicks: 0 },
    score,
  });

  it("returns null with too little data", () => {
    assert.equal(summarizePerformance([post("product", 5, "a"), post("trend", 1, "b")]), null);
  });

  it("names pillar averages and top performers", () => {
    const notes = summarizePerformance([
      post("relatable", 12, "POV: your senior dog owns the couch"),
      post("relatable", 9, "Tell me you have a rescue dog…"),
      post("product", 2, "Shop our new mug!"),
      post("product", 1, "Check out this tee!"),
      post("trend", 5, "Gotcha Day Glow-Up week 1"),
    ]);
    assert.ok(notes);
    assert.match(notes!, /relatable: avg/);
    assert.match(notes!, /Top performers/);
    assert.match(notes!, /POV: your senior dog/);
    assert.match(notes!, /20% exploring/);
  });
});
