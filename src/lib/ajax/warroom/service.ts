/**
 * War Room — strategic analysis over the Archive.
 *
 * Server-only. Reads the full history (ideas + verdicts, listings, operator
 * feedback, orders) and asks an LLM strategist for concrete business moves
 * across four areas: niche strategy, channel expansion, pricing, and cutting
 * underperformers. Recommendations are written to `strategy_recommendations`
 * for the operator to accept / dismiss / mark actioned (human-in-the-loop).
 *
 * "Recommend + draft the work": for niche recommendations it also creates a
 * DRAFT `product_ideas` row (source `war_room`) so the idea is queued for the
 * operator — it never publishes or opens anything on its own.
 */
import { AGENT_SLUGS, ROOM_SLUGS } from "@/lib/ajax/constants";
import { createOpenAiClient, isOpenAiConfigured } from "@/lib/llm/openai";
import type { Json } from "@/lib/supabase/database.types";
import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";

const WARROOM_MODEL = process.env.WARROOM_MODEL?.trim() || "gpt-4o-mini";
const WARROOM_TIMEOUT_MS = 60_000;

export const STRATEGY_CATEGORIES = [
  "niche",
  "channel",
  "pricing",
  "cut",
  "other",
] as const;
export type StrategyCategory = (typeof STRATEGY_CATEGORIES)[number];

export type StrategyRecommendation = {
  id: string;
  runId: string;
  category: StrategyCategory;
  title: string;
  rationale: string;
  recommendedAction: string;
  priority: number;
  confidence: number | null;
  evidence: Json;
  status: "proposed" | "accepted" | "dismissed" | "actioned";
  draftedIdeaId: string | null;
  createdAt: string;
};

export type WarRoomRunResult = {
  ok: boolean;
  runId: string;
  mode: "llm" | "skipped";
  recommendations: StrategyRecommendation[];
  draftedIdeaCount: number;
  message: string;
};

type ArchiveSummary = {
  generatedAt: string;
  ideas: {
    total: number;
    byVerdict: Record<string, number>;
    byStatus: Record<string, number>;
    topNiches: { niche: string; ideas: number; approved: number; avgTrend: number }[];
  };
  listings: {
    total: number;
    byStatus: Record<string, number>;
    published: number;
    pricePoints: number[];
  };
  feedback: { type: string; text: string }[];
  orders: { total: number; byStatus: Record<string, number> };
};

function tally(values: (string | null | undefined)[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) {
    const key = (v ?? "unknown").toString().trim() || "unknown";
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

async function aggregateArchive(
  supabase: Supabase,
  userId: string,
): Promise<ArchiveSummary> {
  const [ideasRes, listingsRes, feedbackRes, ordersRes] = await Promise.all([
    supabase
      .from(TABLES.IDEAS)
      .select("niche,status,brain_verdict,trend_score")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(300),
    supabase
      .from(TABLES.LISTINGS)
      .select("status,price")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(300),
    supabase
      .from(TABLES.FEEDBACK)
      .select("feedback_type,feedback_text")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(40),
    supabase
      .from(TABLES.ORDER_QUEUE)
      .select("status")
      .eq("user_id", userId)
      .limit(300),
  ]);

  const ideaRows = ideasRes.data ?? [];
  const listingRows = listingsRes.data ?? [];
  const feedbackRows = feedbackRes.data ?? [];
  const orderRows = ordersRes.data ?? [];

  const nicheMap = new Map<
    string,
    { ideas: number; approved: number; trendSum: number }
  >();
  for (const row of ideaRows) {
    const niche = (row.niche ?? "unknown").trim() || "unknown";
    const entry = nicheMap.get(niche) ?? { ideas: 0, approved: 0, trendSum: 0 };
    entry.ideas += 1;
    if (row.brain_verdict === "approve_for_generation") entry.approved += 1;
    entry.trendSum += Number(row.trend_score) || 0;
    nicheMap.set(niche, entry);
  }
  const topNiches = [...nicheMap.entries()]
    .map(([niche, v]) => ({
      niche,
      ideas: v.ideas,
      approved: v.approved,
      avgTrend: v.ideas ? Math.round(v.trendSum / v.ideas) : 0,
    }))
    .sort((a, b) => b.ideas - a.ideas)
    .slice(0, 15);

  const pricePoints = listingRows
    .map((r) => Number(r.price))
    .filter((n) => Number.isFinite(n) && n > 0)
    .slice(0, 50);

  return {
    generatedAt: new Date().toISOString(),
    ideas: {
      total: ideaRows.length,
      byVerdict: tally(ideaRows.map((r) => r.brain_verdict)),
      byStatus: tally(ideaRows.map((r) => r.status)),
      topNiches,
    },
    listings: {
      total: listingRows.length,
      byStatus: tally(listingRows.map((r) => r.status)),
      published: listingRows.filter((r) => r.status === "published").length,
      pricePoints,
    },
    feedback: feedbackRows.map((r) => ({
      type: r.feedback_type,
      text: (r.feedback_text ?? "").slice(0, 240),
    })),
    orders: {
      total: orderRows.length,
      byStatus: tally(orderRows.map((r) => r.status)),
    },
  };
}

const SYSTEM_PROMPT = `You are the War Room — the strategist for Octane Ajax, a solo-operator print-on-demand (POD) business selling niche physical gifts (mugs, shirts, posters, etc.), fulfilled by Printify, sold on Etsy.

You are given an ARCHIVE summary of everything the business has done: product ideas and their Product Brain verdicts, listings and their statuses, the operator's approval/rejection feedback, and orders.

Produce concrete, evidence-based recommendations to grow the business across these categories:
- "niche": specific niches/product directions to double down on or try next (grounded in what gets approved and what sells).
- "channel": when to expand channels (e.g., open a second Etsy store for a proven niche, add a new marketplace).
- "pricing": pricing/margin moves based on price points and demand.
- "cut": product lines or patterns to retire (repeatedly rejected or never sell).

Rules:
- Recommend only. The operator decides and executes. Never assume anything was already done.
- Be specific and actionable; cite the archive numbers that justify each recommendation in "evidence".
- Return 4-8 of the highest-leverage recommendations.
- Respond with STRICT JSON: {"recommendations":[{"category","title","rationale","recommended_action","priority"(1=highest..5=lowest),"confidence"(0..1),"evidence"}]}. No prose outside JSON.`;

type RawRec = {
  category?: string;
  title?: string;
  rationale?: string;
  recommended_action?: string;
  priority?: number;
  confidence?: number;
  evidence?: Json;
};

function normalizeCategory(value: unknown): StrategyCategory {
  const v = String(value ?? "").toLowerCase().trim();
  return (STRATEGY_CATEGORIES as readonly string[]).includes(v)
    ? (v as StrategyCategory)
    : "other";
}

function clampPriority(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 3;
  return Math.min(5, Math.max(1, n));
}

function clampConfidence(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(1, Math.max(0, n));
}

/** Runs one War Room analysis and persists recommendations. Never throws. */
export async function runWarRoom(
  supabase: Supabase,
  userId: string,
): Promise<WarRoomRunResult> {
  const runId = crypto.randomUUID();

  if (!isOpenAiConfigured()) {
    return {
      ok: false,
      runId,
      mode: "skipped",
      recommendations: [],
      draftedIdeaCount: 0,
      message: "OPENAI_API_KEY not configured — War Room needs the LLM to analyze the archive.",
    };
  }

  const archive = await aggregateArchive(supabase, userId);

  let rawRecs: RawRec[] = [];
  try {
    const client = createOpenAiClient({ timeout: WARROOM_TIMEOUT_MS });
    const completion = await client.chat.completions.create({
      model: WARROOM_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `ARCHIVE summary (JSON):\n${JSON.stringify(archive)}`,
        },
      ],
    });
    const content = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content) as { recommendations?: RawRec[] };
    rawRecs = Array.isArray(parsed.recommendations)
      ? parsed.recommendations.slice(0, 8)
      : [];
  } catch (err) {
    const message = err instanceof Error ? err.message : "War Room LLM call failed.";
    await insertFactoryEvent(supabase, userId, {
      event_type: "war_room_failed",
      message: `War Room analysis failed: ${message}`,
      metadata: { runId },
    });
    return {
      ok: false,
      runId,
      mode: "llm",
      recommendations: [],
      draftedIdeaCount: 0,
      message,
    };
  }

  const recommendations: StrategyRecommendation[] = [];
  let draftedIdeaCount = 0;

  for (const raw of rawRecs) {
    const category = normalizeCategory(raw.category);
    const title = String(raw.title ?? "").trim().slice(0, 200);
    if (!title) continue;

    const { data: recRow, error: recError } = await supabase
      .from(TABLES.STRATEGY)
      .insert({
        user_id: userId,
        run_id: runId,
        category,
        title,
        rationale: String(raw.rationale ?? "").slice(0, 2000),
        recommended_action: String(raw.recommended_action ?? "").slice(0, 2000),
        priority: clampPriority(raw.priority),
        confidence: clampConfidence(raw.confidence),
        evidence: (raw.evidence ?? {}) as Json,
        status: "proposed",
      })
      .select()
      .single();

    if (recError || !recRow) continue;

    // "Recommend + draft the work": queue a draft idea for niche moves.
    let draftedIdeaId: string | null = null;
    if (category === "niche") {
      const { data: ideaRow } = await supabase
        .from(TABLES.IDEAS)
        .insert({
          user_id: userId,
          source: "war_room",
          status: "idea",
          title,
          niche: title,
          description: String(raw.rationale ?? "").slice(0, 500),
          raw_payload: { warRoom: true, runId, recommendationId: recRow.id } as Json,
        })
        .select("id")
        .single();
      if (ideaRow?.id) {
        draftedIdeaId = ideaRow.id;
        draftedIdeaCount += 1;
        await supabase
          .from(TABLES.STRATEGY)
          .update({ drafted_idea_id: draftedIdeaId })
          .eq("id", recRow.id)
          .eq("user_id", userId);
      }
    }

    recommendations.push({
      id: recRow.id,
      runId,
      category,
      title: recRow.title,
      rationale: recRow.rationale,
      recommendedAction: recRow.recommended_action,
      priority: recRow.priority,
      confidence: recRow.confidence,
      evidence: recRow.evidence,
      status: "proposed",
      draftedIdeaId,
      createdAt: recRow.created_at,
    });
  }

  await insertFactoryEvent(supabase, userId, {
    event_type: "war_room_run",
    message: `War Room produced ${recommendations.length} recommendation(s)${
      draftedIdeaCount ? `, drafted ${draftedIdeaCount} idea(s)` : ""
    }.`,
    metadata: { runId, count: recommendations.length, draftedIdeaCount },
  });

  return {
    ok: true,
    runId,
    mode: "llm",
    recommendations,
    draftedIdeaCount,
    message: `War Room produced ${recommendations.length} recommendation(s).`,
  };
}

/** Fetch recent recommendations for the dashboard (newest first). */
export async function fetchStrategyRecommendations(
  supabase: Supabase,
  userId: string,
): Promise<StrategyRecommendation[]> {
  const { data, error } = await supabase
    .from(TABLES.STRATEGY)
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(60);
  if (error || !data) return [];
  return data.map((r) => ({
    id: r.id,
    runId: r.run_id,
    category: normalizeCategory(r.category),
    title: r.title,
    rationale: r.rationale,
    recommendedAction: r.recommended_action,
    priority: r.priority,
    confidence: r.confidence,
    evidence: r.evidence,
    status: r.status as StrategyRecommendation["status"],
    draftedIdeaId: r.drafted_idea_id,
    createdAt: r.created_at,
  }));
}

async function insertFactoryEvent(
  supabase: Supabase,
  userId: string,
  payload: { event_type: string; message: string; metadata?: Json },
): Promise<void> {
  const { error } = await supabase.from(TABLES.EVENTS).insert({
    user_id: userId,
    event_type: payload.event_type,
    message: payload.message,
    agent_slug: AGENT_SLUGS.NOVA,
    room: ROOM_SLUGS.RESEARCH_LAB,
    metadata: payload.metadata ?? {},
  });
  if (error) {
    console.error("[war-room] failed to log factory event", error);
  }
}
