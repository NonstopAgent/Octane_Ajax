import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { TABLES } from "@/lib/supabase/schema";

/**
 * GET /api/ajax/mission-control — one aggregated snapshot of what the
 * autonomous system is doing: agent heartbeats, autopilot pulse, the
 * production line, spend, shop performance, and the recent activity feed.
 *
 * Read-only by design. There is deliberately NO "needs your call" payload —
 * the operator asked for a dashboard that shows the machine WORKING, not one
 * that generates chores.
 */

type AgentCard = {
  slug: string;
  name: string;
  status: string;
  room: string | null;
  lastHeartbeat: string | null;
  currentTask: string | null;
  tasksCompleted7d: number;
  lastCompletedAt: string | null;
};

export async function GET() {
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
    const userId = user.id;
    const now = Date.now();
    const dayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const utcDayStart = new Date();
    utcDayStart.setUTCHours(0, 0, 0, 0);

    const [
      agentsRes,
      tasksRes,
      autopilotEventsRes,
      lastSummaryRes,
      listingsRes,
      pendingReviewsRes,
      seedsRes,
      usageRes,
      rendersTodayRes,
      perfRes,
      feedRes,
    ] = await Promise.all([
      supabase
        .from(TABLES.AGENTS)
        .select("slug, name, status, current_room, current_task_id, last_heartbeat"),
      supabase
        .from(TABLES.TASKS)
        .select("id, agent_slug, task_type, status, completed_at, created_at")
        .eq("user_id", userId)
        .gte("created_at", weekAgo)
        .order("created_at", { ascending: false })
        .limit(400),
      supabase
        .from(TABLES.EVENTS)
        .select("created_at")
        .eq("user_id", userId)
        .eq("event_type", "autopilot_started")
        .gte("created_at", dayAgo)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from(TABLES.EVENTS)
        .select("message, created_at")
        .eq("user_id", userId)
        .eq("event_type", "autopilot_summary")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from(TABLES.LISTINGS)
        .select("status")
        .eq("user_id", userId)
        .limit(500),
      supabase
        .from(TABLES.REVIEW_QUEUE)
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("status", "pending"),
      supabase
        .from(TABLES.IDEAS)
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("status", "idea")
        .eq("raw_payload->>operatorSeed", "true"),
      supabase
        .from(TABLES.LLM_USAGE)
        .select("cost_usd, created_at")
        .eq("user_id", userId)
        .gte("created_at", weekAgo)
        .limit(2000),
      supabase
        .from(TABLES.VIDEO_JOBS)
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("created_at", utcDayStart.toISOString()),
      supabase
        .from(TABLES.LISTING_PERFORMANCE)
        .select("snapshot_date, views, favorites, orders, revenue_cents")
        .eq("user_id", userId)
        .order("snapshot_date", { ascending: false })
        .limit(200),
      supabase
        .from(TABLES.EVENTS)
        .select("event_type, message, created_at, agent_slug")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(15),
    ]);

    // ---- Agents -------------------------------------------------------------
    const tasks = tasksRes.data ?? [];
    const taskById = new Map(tasks.map((t) => [t.id, t]));
    const agents: AgentCard[] = (agentsRes.data ?? []).map((a) => {
      const mine = tasks.filter((t) => t.agent_slug === a.slug);
      const completed = mine.filter((t) => t.status === "completed");
      const current = a.current_task_id
        ? taskById.get(a.current_task_id)
        : null;
      return {
        slug: String(a.slug ?? ""),
        name: String(a.name ?? a.slug ?? ""),
        status: String(a.status ?? "offline"),
        room: a.current_room ? String(a.current_room) : null,
        lastHeartbeat: a.last_heartbeat ? String(a.last_heartbeat) : null,
        currentTask: current?.task_type ? String(current.task_type) : null,
        tasksCompleted7d: completed.length,
        lastCompletedAt:
          completed
            .map((t) => t.completed_at)
            .filter(Boolean)
            .sort()
            .reverse()[0] ?? null,
      };
    });

    // ---- Autopilot pulse ----------------------------------------------------
    const passes = autopilotEventsRes.data ?? [];
    const autopilot = {
      lastPassAt: passes[0]?.created_at ?? null,
      passes24h: passes.length,
      lastSummary: lastSummaryRes.data?.message ?? null,
      lastSummaryAt: lastSummaryRes.data?.created_at ?? null,
    };

    // ---- Production line ----------------------------------------------------
    const statusCounts: Record<string, number> = {};
    for (const row of listingsRes.data ?? []) {
      const s = String(row.status ?? "unknown");
      statusCounts[s] = (statusCounts[s] ?? 0) + 1;
    }
    const production = {
      listingsByStatus: statusCounts,
      pendingReviews: pendingReviewsRes.count ?? 0,
      operatorSeedsWaiting: seedsRes.count ?? 0,
    };

    // ---- Spend --------------------------------------------------------------
    const usage = usageRes.data ?? [];
    const llmCost7d = usage.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
    const llmCostToday = usage
      .filter((r) => String(r.created_at ?? "") >= utcDayStart.toISOString())
      .reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
    const spend = {
      llmCostToday: Math.round(llmCostToday * 100) / 100,
      llmCost7d: Math.round(llmCost7d * 100) / 100,
      videoRendersToday: rendersTodayRes.count ?? 0,
      videoDailyCap: (() => {
        const raw = Number(process.env.VIDEO_DAILY_RENDER_CAP);
        return Number.isFinite(raw) && raw > 0 ? raw : 8;
      })(),
    };

    // ---- Shop performance (latest snapshot day) -----------------------------
    const perfRows = perfRes.data ?? [];
    const latestDate = perfRows[0]?.snapshot_date ?? null;
    const latest = perfRows.filter((r) => r.snapshot_date === latestDate);
    const performance = latestDate
      ? {
          snapshotDate: latestDate,
          views: latest.reduce((s, r) => s + Number(r.views ?? 0), 0),
          favorites: latest.reduce((s, r) => s + Number(r.favorites ?? 0), 0),
          orders: latest.reduce((s, r) => s + Number(r.orders ?? 0), 0),
          revenueCents: latest.reduce(
            (s, r) => s + Number(r.revenue_cents ?? 0),
            0,
          ),
        }
      : null;

    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      agents,
      autopilot,
      production,
      spend,
      performance,
      feed: (feedRes.data ?? []).map((e) => ({
        type: String(e.event_type ?? ""),
        message: String(e.message ?? ""),
        at: String(e.created_at ?? ""),
        agent: e.agent_slug ? String(e.agent_slug) : null,
      })),
    });
  } catch (err) {
    console.error("[mission-control] snapshot failed", err);
    return NextResponse.json(
      { ok: false, error: "Failed to build the mission-control snapshot." },
      { status: 500 },
    );
  }
}
