import "server-only";

/**
 * Trend research — Pixel's live window into what's working on social RIGHT
 * NOW. Uses Gemini with Google Search grounding (already-configured key, no
 * new vendors) to pull current pet-niche trends across TikTok + Pinterest:
 * formats, hook styles, sound/meme themes, hashtags, and seasonal searches.
 *
 * The brief is cached in factory_events for ~20h so the hourly autopilot
 * refreshes it about once a day for pennies. DORMANT without GEMINI_API_KEY
 * (returns null; prompts simply omit the trend block).
 */
import type { Json } from "@/lib/supabase/database.types";
import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";

const TREND_EVENT = "social_trend_brief";
const CACHE_HOURS = 20;
const MAX_BRIEF_CHARS = 1600;

function geminiKey(): string | undefined {
  return (
    process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim()
  );
}

export function isTrendResearchConfigured(): boolean {
  return Boolean(geminiKey());
}

const TREND_PROMPT = `Search the web for what is trending RIGHT NOW (this week) for pet/dog/cat content creators and shops on TikTok and Pinterest. Then write a compact intelligence brief for a small Etsy shop (GotchaDayGoods: personalized gifts for pet parents — gotcha day, rescue pride, senior dogs, pet memorials).

Cover, with specifics:
1. TikTok: 3-5 trending formats/hooks/meme or sound THEMES that pet accounts are riding this week (describe the format so a creator can copy it — do not just name a song).
2. Pinterest: what pet-related searches/aesthetics are seasonally rising right now (this month), phrased as search keywords.
3. Hashtags: currently active pet-niche tags on each platform (not evergreen generics only).
4. One upcoming pet-related date/occasion in the next 3 weeks worth planning content for.

Rules: be concrete and current (cite the trend, not advice). Plain text, tight bullets, under 220 words. No preamble.`;

/** Fetch (or reuse) today's trend brief. Never throws — null when unavailable. */
export async function fetchTrendBrief(
  supabase: Supabase,
  userId: string,
): Promise<string | null> {
  try {
    // Reuse the cached brief when it's fresh (~daily refresh).
    const since = new Date(
      Date.now() - CACHE_HOURS * 60 * 60 * 1000,
    ).toISOString();
    const { data: cached } = await supabase
      .from(TABLES.EVENTS)
      .select("metadata, created_at")
      .eq("user_id", userId)
      .eq("event_type", TREND_EVENT)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1);
    const cachedBrief = (
      cached?.[0]?.metadata as { brief?: string } | null
    )?.brief;
    if (cachedBrief?.trim()) return cachedBrief;

    const key = geminiKey();
    if (!key) return null;

    const model =
      process.env.TREND_RESEARCH_MODEL?.trim() || "gemini-2.0-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model,
    )}:generateContent?key=${key}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: TREND_PROMPT }] }],
        // Live Google Search grounding — this is what makes the brief CURRENT.
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.4 },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const brief = (
      json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ??
      ""
    )
      .trim()
      .slice(0, MAX_BRIEF_CHARS);
    if (!brief) return null;

    await supabase.from(TABLES.EVENTS).insert({
      user_id: userId,
      event_type: TREND_EVENT,
      message: `Pixel trend research refreshed — ${brief.slice(0, 90)}…`,
      agent_slug: "pixel",
      room: "media_studio",
      metadata: { brief, model } as unknown as Json,
    });
    return brief;
  } catch {
    return null;
  }
}

/** Content pillars — the posting mix. Not every post is an ad. */
export const CONTENT_PILLARS = ["product", "relatable", "trend"] as const;
export type ContentPillar = (typeof CONTENT_PILLARS)[number];

/** Deterministic pillar rotation (~40% product, ~40% relatable, ~20% trend). */
export function pillarForIndex(index: number): ContentPillar {
  const cycle: ContentPillar[] = [
    "product",
    "relatable",
    "product",
    "relatable",
    "trend",
  ];
  return cycle[index % cycle.length] ?? "product";
}
