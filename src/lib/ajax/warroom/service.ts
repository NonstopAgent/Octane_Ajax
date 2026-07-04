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
import {
  fetchPerformanceSummary,
  type PerformanceSummary,
} from "@/lib/ajax/analytics/etsy-snapshots";
import { z } from "zod";
import { completeJson } from "@/lib/llm/json";
import { isOpenAiConfigured } from "@/lib/llm/openai";
import { isProviderConfigured } from "@/lib/llm/providers";
import type { Json } from "@/lib/supabase/database.types";
import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";
import {
  fetchWarRoomSignals,
  formatSignalsForPrompt,
} from "@/lib/ajax/warroom/signals";
export { fetchWarRoomSignals } from "@/lib/ajax/warroom/signals";
export type { WarRoomSignals } from "@/lib/ajax/warroom/signals";

// War Room routes through the shared task router (see lib/llm/providers): the
// "strategy" task prefers Claude and falls back to OpenAI automatically. This
// keeps the strategist on a strong reasoning model instead of a cheap default.
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
  performance: PerformanceSummary;
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

  // Real Etsy performance (views velocity, revenue, traffic-but-no-sales) so the
  // strategist reasons about what actually converts, not just what gets made.
  const performance = await fetchPerformanceSummary(supabase, userId);

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
    performance,
  };
}

const SYSTEM_PROMPT = `You are the War Room — head of growth and strategy for GotchaDayGoods (internal codename "Octane Ajax"), a solo-operator print-on-demand shop that sells gifts FOR PET PARENTS (dogs first, then cats and other companion animals). Original AI-assisted artwork on mugs, posters, art prints, apparel, tote bags, and phone cases; fulfilled by Printify; sold on Etsy. One operator with limited hours — every recommendation must earn its slot.

This is a PET shop only. The archive still contains off-brand niches left over from an earlier "sell everything" phase (e.g. night-shift nurses, backyard chicken keepers, remote workers, gardeners, roller skaters, book lovers, graphic designers). Treat every non-pet niche as OUT OF SCOPE: recommend retiring/cutting it and redirect that energy into pet niches — even if it shows high approvals or trend scores. NEVER recommend doubling down on a non-pet niche. The winning niches to grow are the pet ones: rescue/adoption, gotcha day, senior and special-needs pets, breed pride, pet memorials, and pet-parent humor.

You are handed an ARCHIVE: product ideas and their Product Brain verdicts, listings and statuses, the operator's approve/reject feedback, orders, and — most importantly — live Etsy performance (7-day revenue, orders, view-velocity leaders, and listings with traffic but zero sales).

## HOW TO THINK
1. Follow the money first. Real revenue, orders, and Etsy views are ground truth; approvals and trend scores are only leading indicators. Weight anything with real sales or real views far above anything still theoretical.
2. Exploit what converts. Niches/formats that are both approved AND getting views or sales are your base — name them specifically and say how to widen them.
3. Fix the leaks. A "traffic but no sales" listing is proven demand with a broken offer. Recommend a concrete title / price / photo fix for that specific listing, never a vague "optimize".
4. Cut dead weight. Niches repeatedly rejected, or published with no traffic, should be retired so the operator stops burning cycles on them.
5. Respect the pricing model. Prices INCLUDE free US shipping (baked in for Etsy's free-shipping ranking boost): mugs $22.99–29.99, posters/prints $27.99–44.99, apparel $29.99–44.99, totes/cases $24.99–34.99; new-shop items price toward the low end. Never recommend prices outside these bands.
6. Occasion beats aesthetic. The brand wins on gift occasions with urgency — gotcha day, adoption day, pet memorial, retirement, appreciation weeks, milestone birthdays. Personalization (a pet's name, breed, or portrait) and a built-in occasion are the two highest-converting proven levers — favor niches and fixes that add them.
7. Use the REAL market + health signals below the archive. Actual search demand vs. competing-listing supply beats internal trend scores — prefer niches with proven demand and open supply, and flag saturated red-ocean terms. When shop health is low, prioritize the specific store-QA fixes that raise it BEFORE recommending more new products.

## CATEGORIES
- "niche": specific niches/product directions to double down on or try next, grounded in what is approved AND actually getting views/sales.
- "channel": when to widen distribution (a second Etsy shop for a proven niche, a new marketplace) — only after a niche has proven demand.
- "pricing": concrete pricing/margin moves tied to real price points and conversion.
- "cut": product lines or patterns to retire (repeatedly rejected, or published with no traffic).

## RULES
- Recommend only. The operator decides and executes. Never assume anything was already done.
- Be specific enough to act on today: name the niche or listing, the exact move, and the number that justifies it.
- Quantify. Each recommendation carries 1–3 short factual "evidence" strings, each citing an archive or performance number. If the archive is thin, say so and recommend the cheapest experiment to generate signal — never invent data.
- Prioritize by expected revenue impact vs. effort: priority 1 = the highest-leverage move to make next; 5 = nice-to-have.
- Calibrate confidence to how much real evidence backs it — sales/views = high; pure theory = low.
- Return 4–8 recommendations, ordered best-first, no two saying the same thing.`;

const WARROOM_JSON_INSTRUCTIONS = `Return a single JSON object of exactly this shape:
{
  "recommendations": [
    {
      "category": "niche | channel | pricing | cut",
      "title": "string — the move in under 8 words, e.g. 'Double down on pet-memorial mugs'",
      "rationale": "string — why now, grounded in the archive/performance numbers",
      "recommended_action": "string — the concrete next step, naming any target listing, price, or count",
      "priority": 1,
      "confidence": 0.0,
      "evidence": ["short factual string citing a number", "..."]
    }
  ]
}
priority is an integer 1 (highest) to 5 (lowest). confidence is 0..1. evidence is an array of 1–3 short strings. No prose outside the JSON object.`;

const StrategyRecSchema = z.object({
  category: z.string().optional(),
  title: z.string(),
  rationale: z.string().optional(),
  recommended_action: z.string().optional(),
  priority: z.union([z.number(), z.string()]).optional(),
  confidence: z.union([z.number(), z.string()]).optional(),
  evidence: z.unknown().optional(),
});

const WarRoomResponseSchema = z.object({
  recommendations: z.array(StrategyRecSchema),
});

type RawRec = z.infer<typeof StrategyRecSchema>;

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

  if (!isProviderConfigured("anthropic") && !isOpenAiConfigured()) {
    return {
      ok: false,
      runId,
      mode: "skipped",
      recommendations: [],
      draftedIdeaCount: 0,
      message:
        "No LLM provider configured — add ANTHROPIC_API_KEY or OPENAI_API_KEY so the War Room can analyze the archive.",
    };
  }

  const archive = await aggregateArchive(supabase, userId);
  const signals = await fetchWarRoomSignals(supabase, userId);

  let rawRecs: RawRec[] = [];
  let strategistModel = "";
  try {
    const result = await completeJson({
      task: "strategy",
      schema: WarRoomResponseSchema,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `ARCHIVE summary (JSON):\n${JSON.stringify(
            archive,
          )}\n\n${formatSignalsForPrompt(signals)}`,
        },
      ],
      jsonInstructions: WARROOM_JSON_INSTRUCTIONS,
      options: { temperature: 0.4, maxTokens: 2600 },
      timeout: WARROOM_TIMEOUT_MS,
      maxRetries: 1,
    });
    strategistModel = result.model;
    rawRecs = result.data.recommendations.slice(0, 8);
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
    }${strategistModel ? ` via ${strategistModel}` : ""}.`,
    metadata: {
      runId,
      count: recommendations.length,
      draftedIdeaCount,
      model: strategistModel,
    },
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
