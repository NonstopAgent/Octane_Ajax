"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EventFeed } from "@/components/factory/event-feed";
import { RoomStation } from "@/components/factory/room-station";
import { TikTokQueuePanel } from "@/components/factory/tiktok-queue-panel";
import { type VisAgent, type VisMetrics } from "@/components/factory/factory-vis-map";
import { FactoryFloor3D } from "@/components/factory/factory-floor-3d";
import type { AjaxAgent, FactoryEvent } from "@/lib/ajax/types";
import type { TikTokQueueRow } from "@/lib/ajax/tiktok/types";
import type { OrderQueueRow } from "@/lib/ajax/pod/order-types";
import type { AgentStatus } from "@/lib/ajax/status";
import type { AgentSlug } from "@/lib/ajax/types";
import Link from "next/link";
import {
  ToastBanner,
  type ToastState,
  type ToastTone,
} from "@/components/factory/toast-banner";
import { useAjaxRealtime } from "@/hooks/useAjaxRealtime";
import { createClient } from "@/lib/supabase/client";
import { mapAgentFromDb, mapEventFromDb } from "@/lib/ajax/mappers";
import { TABLES } from "@/lib/supabase/schema";

type FactorySweatshopProps = {
  isAuthenticated: boolean;
  configReady: boolean;
  initialEvents: FactoryEvent[];
  initialOrders: OrderQueueRow[];
  initialTikTokQueue: TikTokQueueRow[];
  initialAgents: AjaxAgent[];
  initialMetrics: VisMetrics;
  businessLabel: string;
  businessId: string | null;
  businessIncludeNull: boolean;
};

function toVisAgent(agent: AjaxAgent): VisAgent {
  return {
    slug: agent.slug as AgentSlug,
    status: agent.status as AgentStatus,
    currentRoom: agent.currentRoom ?? null,
  };
}

export function FactorySweatshop({
  isAuthenticated,
  configReady,
  initialEvents,
  initialOrders,
  initialTikTokQueue,
  initialAgents,
  initialMetrics,
  businessLabel,
  businessId,
  businessIncludeNull,
}: FactorySweatshopProps) {
  const [agents, setAgents] = useState<AjaxAgent[]>(initialAgents);
  const [metrics, setMetrics] = useState<VisMetrics>(initialMetrics);
  const [running, setRunning] = useState(false);
  const [cyclePhase, setCyclePhase] = useState<"nova" | "forge" | null>(null);
  const [runningPixel, setRunningPixel] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [autopilot, setAutopilot] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [lastEventMsg, setLastEventMsg] = useState<string | undefined>(
    initialEvents[0] ? String(initialEvents[0].message ?? "") : undefined,
  );

  const showToast = useCallback((tone: ToastTone, message: string) => {
    setToast({ tone, message });
    window.setTimeout(() => setToast(null), 6000);
  }, []);

  const refreshAgentsAndMetrics = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const bizClause = businessId
      ? businessIncludeNull
        ? `business_id.eq.${businessId},business_id.is.null`
        : `business_id.eq.${businessId}`
      : null;

    const ideasBase = supabase
      .from(TABLES.IDEAS)
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);
    const reviewsBase = supabase
      .from(TABLES.REVIEW_QUEUE)
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "pending");
    const jobsBase = supabase
      .from(TABLES.CONTENT_JOBS)
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "scheduled");
    const listingsBase = supabase
      .from(TABLES.LISTINGS)
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "published");

    const [agentsRes, ideasRes, reviewsRes, jobsRes, listingsRes, eventsRes] =
      await Promise.all([
        supabase.from(TABLES.AGENTS).select("*").order("slug"),
        bizClause ? ideasBase.or(bizClause) : ideasBase,
        bizClause ? reviewsBase.or(bizClause) : reviewsBase,
        bizClause ? jobsBase.or(bizClause) : jobsBase,
        bizClause ? listingsBase.or(bizClause) : listingsBase,
        supabase
          .from(TABLES.EVENTS)
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(1),
      ]);

    if (!agentsRes.error)
      setAgents((agentsRes.data ?? []).map(mapAgentFromDb));
    setMetrics({
      productIdeas: ideasRes.count ?? 0,
      pendingReviews: reviewsRes.count ?? 0,
      scheduledContent: jobsRes.count ?? 0,
      publishedListings: listingsRes.count ?? 0,
    });
    if (!eventsRes.error && eventsRes.data?.[0]) {
      const ev = mapEventFromDb(eventsRes.data[0]);
      setLastEventMsg(String(ev.message ?? ""));
    }
  }, [businessId, businessIncludeNull]);

  const realtimeEnabled = configReady && isAuthenticated;

  const { refresh } = useAjaxRealtime({
    enabled: realtimeEnabled,
    onRefresh: refreshAgentsAndMetrics,
  });

  const runCycle = useCallback(async (autoReview = false) => {
    setRunning(true);
    setCyclePhase("nova");
    try {
      const novaRes = await fetch("/api/ajax/run-nova", {
        method: "POST",
        credentials: "include",
      });
      const novaData = await novaRes.json();

      if (novaRes.status === 409) {
        showToast("info", novaData.error ?? "Cycle blocked — resolve review first.");
        return;
      }
      if (!novaRes.ok) {
        showToast("error", novaData.error ?? "Nova step failed.");
        await refresh();
        return;
      }

      setCyclePhase("forge");
      const forgeRes = await fetch("/api/ajax/run-forge", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: novaData.runId }),
      });
      const forgeData = await forgeRes.json();

      if (forgeRes.status === 409) {
        showToast("info", forgeData.error ?? "Cycle blocked — resolve review first.");
        await refresh();
        return;
      }
      if (!forgeRes.ok) {
        showToast("error", forgeData.error ?? "Forge step failed.");
        await refresh();
        return;
      }

      // Autopilot: let the AI reviewer clear the gate on its own. Approve →
      // Etsy DRAFT (never live); reject → back to agents; revise → stays pending,
      // which pauses autopilot for you. Manual runs still stop at the gate.
      if (autoReview && forgeData.review?.id) {
        try {
          const arRes = await fetch("/api/ajax/review/ai-review", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              reviewId: forgeData.review.id,
              autonomous: true,
            }),
          });
          const ar = await arRes.json().catch(() => ({}));
          if (!arRes.ok || !ar?.ok) {
            showToast(
              "info",
              ar?.error ?? "AI review unavailable — listing left at the gate.",
            );
          } else if (ar.acted === "approved") {
            showToast(
              "success",
              `AI approved (${ar.overallScore}/100) — Etsy draft created.`,
            );
          } else if (ar.acted === "rejected") {
            showToast(
              "info",
              `AI rejected (${ar.overallScore}/100) — sent back to the agents.`,
            );
          } else {
            showToast(
              "info",
              `AI says revise (${ar.overallScore}/100) — left at the gate for you.`,
            );
          }
        } catch {
          showToast("info", "AI review failed — listing left at the gate.");
        }
      } else {
        showToast("success", forgeData.message ?? "Cycle paused at Review Gate.");
      }
      await refresh();
    } catch {
      showToast("error", "Request failed or timed out.");
      await refresh();
    } finally {
      setRunning(false);
      setCyclePhase(null);
    }
  }, [showToast, refresh]);

  // Autopilot gate-drainer: AI-review the oldest pending listing (no reviewId →
  // the route auto-picks it). Self-guards against overlapping runs.
  const autoReviewingRef = useRef(false);
  const autoReviewNext = useCallback(async () => {
    if (autoReviewingRef.current) return;
    autoReviewingRef.current = true;
    try {
      const res = await fetch("/api/ajax/review/ai-review", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autonomous: true }),
      });
      const ar = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        acted?: "approved" | "rejected" | null;
        overallScore?: number;
      };
      if (res.ok && ar?.ok && ar.acted) {
        showToast(
          ar.acted === "approved" ? "success" : "info",
          `AI ${ar.acted} a pending listing · ${ar.overallScore}/100.`,
        );
      }
    } catch {
      // best-effort; the loop will retry on the next tick
    } finally {
      autoReviewingRef.current = false;
      await refresh();
    }
  }, [showToast, refresh]);

  const runPixel = useCallback(async () => {
    setRunningPixel(true);
    try {
      const res = await fetch("/api/ajax/run-pixel", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (res.status === 409) {
        showToast("info", data.error ?? "No queued content — approve a listing first.");
        return;
      }
      if (!res.ok) {
        showToast("error", data.error ?? "Failed to run Pixel.");
        return;
      }
      showToast("success", data.message ?? "Pixel scheduled promo content.");
      await refresh();
    } catch {
      showToast("error", "Network error while running Pixel.");
    } finally {
      setRunningPixel(false);
    }
  }, [showToast, refresh]);

  const resetFactory = useCallback(async () => {
    if (
      !window.confirm(
        "Clear all pipeline data and reset agents to idle?",
      )
    )
      return;

    setResetting(true);
    try {
      const res = await fetch("/api/ajax/reset-demo", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        showToast("error", data.error ?? "Failed to reset factory.");
        return;
      }
      showToast("success", data.message ?? "Factory cleared.");
      await refresh();
    } catch {
      showToast("error", "Network error while resetting.");
    } finally {
      setResetting(false);
    }
  }, [showToast, refresh]);

  // Autopilot — the "it runs itself" loop. When on, it runs a full
  // Nova→Forge→AI-Review cycle whenever the floor is idle and nothing is waiting
  // at the gate. The AI reviewer auto-clears strong listings (approve → Etsy
  // DRAFT only, never live) and sends weak ones back; a "revise" verdict leaves
  // the item pending, which pauses autopilot for you. It never publishes live or
  // spends beyond one cycle + one review. Refs avoid stale closures.
  const autopilotRef = useRef(autopilot);
  const gateRef = useRef({ running, runningPixel, resetting, pending: metrics.pendingReviews });
  useEffect(() => {
    autopilotRef.current = autopilot;
  }, [autopilot]);
  useEffect(() => {
    gateRef.current = { running, runningPixel, resetting, pending: metrics.pendingReviews };
  }, [running, runningPixel, resetting, metrics.pendingReviews]);
  useEffect(() => {
    if (!autopilot) return;
    const id = window.setInterval(() => {
      const g = gateRef.current;
      if (
        autopilotRef.current &&
        !g.running &&
        !g.runningPixel &&
        !g.resetting
      ) {
        // Drain the gate first (clear any pending review), then make more.
        if (g.pending > 0) void autoReviewNext();
        else void runCycle(true);
      }
    }, 18000);
    return () => window.clearInterval(id);
  }, [autopilot, runCycle, autoReviewNext]);

  if (!configReady) {
    return (
      <div className="factory-panel panel-glow-orange max-w-xl">
        <h1 className="text-xl font-bold">Supabase not configured</h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to
          .env.local, then restart.
        </p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="factory-panel panel-glow-orange max-w-xl">
        <h1 className="text-xl font-bold">Sign in required</h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Sign in to run the factory pipeline.
        </p>
        <Link
          href="/login?next=/factory"
          className="mt-4 inline-flex text-sm font-semibold text-[var(--accent-blue)] hover:underline"
        >
          Sign in →
        </Link>
      </div>
    );
  }

  const visAgents = agents.map(toVisAgent);

  return (
    <div className="space-y-4">
      <ToastBanner toast={toast} />

      {/* Primary visual: 3D factory floor command center */}
      <FactoryFloor3D
        agents={visAgents}
        metrics={metrics}
        running={running}
        cyclePhase={cyclePhase}
        runningPixel={runningPixel}
        resetting={resetting}
        autopilot={autopilot}
        businessLabel={businessLabel}
        lastEventMessage={lastEventMsg}
        onRunCycle={() => void runCycle()}
        onRunPixel={() => void runPixel()}
        onResetFactory={() => void resetFactory()}
        onToggleAutopilot={() => setAutopilot((v) => !v)}
      />

      {/* Room 2, Room 3, and event log below the map */}
      <div className="grid gap-4 lg:grid-cols-5 lg:gap-5">
        <div className="space-y-4 lg:col-span-2">
          <RoomStation enabled={realtimeEnabled} initialOrders={initialOrders} />
          <TikTokQueuePanel
            enabled={realtimeEnabled}
            initialItems={initialTikTokQueue}
          />
        </div>
        <div className="lg:col-span-3">
          <EventFeed enabled={realtimeEnabled} initialEvents={initialEvents} />
        </div>
      </div>
    </div>
  );
}
