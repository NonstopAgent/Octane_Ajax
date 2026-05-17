"use client";

import { useCallback, useState } from "react";
import { AgentStatusPanel } from "@/components/factory/agent-status-panel";
import { ControlPanel } from "@/components/factory/control-panel";
import { EventFeed } from "@/components/factory/event-feed";
import { FactoryMap } from "@/components/factory/factory-map";
import { LiveStatusBar } from "@/components/factory/live-status-bar";
import { MetricsStrip } from "@/components/factory/metrics-strip";
import {
  ToastBanner,
  type ToastState,
  type ToastTone,
} from "@/components/factory/toast-banner";
import { useAjaxRealtime } from "@/hooks/useAjaxRealtime";
import type { FactorySnapshot } from "@/lib/factory/types";
import { CommandHeader } from "@/components/layout/command-header";
import { PIPELINE_STAGES } from "@/lib/ajax/constants";
import Link from "next/link";

const EMPTY_SNAPSHOT: FactorySnapshot = {
  agents: [],
  tasksById: {},
  events: [],
  metrics: {
    productIdeas: 0,
    pendingReviews: 0,
    scheduledContent: 0,
    publishedListings: 0,
  },
};

type FactoryDashboardProps = {
  initialSnapshot: FactorySnapshot | null;
  isAuthenticated: boolean;
  configReady: boolean;
};

export function FactoryDashboard({
  initialSnapshot,
  isAuthenticated,
  configReady,
}: FactoryDashboardProps) {
  const [snapshot, setSnapshot] = useState<FactorySnapshot>(
    initialSnapshot ?? EMPTY_SNAPSHOT,
  );
  const [running, setRunning] = useState(false);
  const [runningPixel, setRunningPixel] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);

  const showToast = useCallback((tone: ToastTone, message: string) => {
    setToast({ tone, message });
    window.setTimeout(() => setToast(null), 6000);
  }, []);

  const refreshSnapshot = useCallback(async () => {
    const res = await fetch("/api/ajax/factory-snapshot", {
      credentials: "include",
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.ok) {
      setSnapshot({
        agents: data.agents,
        tasksById: data.tasksById,
        events: data.events,
        metrics: data.metrics,
      });
    }
  }, []);

  const realtimeEnabled = configReady && isAuthenticated;

  const { status: liveStatus, lastUpdated, isRefreshing, refresh } =
    useAjaxRealtime({
      enabled: realtimeEnabled,
      onRefresh: refreshSnapshot,
    });

  const runCycle = async () => {
    setRunning(true);
    try {
      const res = await fetch("/api/ajax/run-cycle", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();

      if (res.status === 409) {
        showToast("info", data.error ?? "Cycle blocked — resolve review first.");
        return;
      }

      if (!res.ok) {
        showToast("error", data.error ?? "Failed to run Ajax cycle.");
        return;
      }

      showToast(
        "success",
        data.message ?? "Cycle complete — listing awaiting your review.",
      );
      await refresh();
    } catch {
      showToast("error", "Network error while running cycle.");
    } finally {
      setRunning(false);
    }
  };

  const runPixel = async () => {
    setRunningPixel(true);
    try {
      const res = await fetch("/api/ajax/run-pixel", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();

      if (res.status === 409) {
        showToast(
          "info",
          data.error ?? "No queued content — approve a listing first.",
        );
        return;
      }

      if (!res.ok) {
        showToast("error", data.error ?? "Failed to run Pixel.");
        return;
      }

      showToast(
        "success",
        data.message ?? "Pixel scheduled promo content.",
      );
      await refresh();
    } catch {
      showToast("error", "Network error while running Pixel.");
    } finally {
      setRunningPixel(false);
    }
  };

  const resetDemo = async () => {
    if (
      !window.confirm(
        "Clear all your demo pipeline data and reset agents to idle?",
      )
    ) {
      return;
    }

    setResetting(true);
    try {
      const res = await fetch("/api/ajax/reset-demo", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();

      if (!res.ok) {
        showToast("error", data.error ?? "Failed to reset demo factory.");
        return;
      }

      showToast("success", data.message ?? "Demo factory reset.");
      await refresh();
    } catch {
      showToast("error", "Network error while resetting.");
    } finally {
      setResetting(false);
    }
  };

  if (!configReady) {
    return (
      <FactoryAuthCallout
        title="Supabase not configured"
        body="Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local, then restart the dev server."
      />
    );
  }

  if (!isAuthenticated) {
    return (
      <FactoryAuthCallout
        title="Sign in required"
        body="Sign in to run the demo pipeline. Your session is scoped with Supabase RLS."
        href="/login?next=/factory"
        hrefLabel="Sign in"
      />
    );
  }

  return (
    <div className="space-y-6">
      <CommandHeader
        badge="Live floor"
        title="Factory command deck"
        description={
          <>
            Watch Nova, Forge, and Pixel move through the pipeline. Events stream
            in real time.{" "}
            <Link
              href="/agents"
              className="text-[var(--accent-blue)] hover:underline"
            >
              View agent memory →
            </Link>
          </>
        }
        aside={
          <LiveStatusBar
            status={liveStatus}
            lastUpdated={lastUpdated}
            isRefreshing={isRefreshing}
            onRefresh={() => void refresh()}
          />
        }
        sysline="SYS.AJAX.FLOOR :: REALTIME"
      />

      <div className="pipeline-ribbon factory-panel py-3">
        {PIPELINE_STAGES.map((stage, i) => (
          <span key={stage.id} className="inline-flex items-center gap-1">
            {i > 0 && <span className="arrow">→</span>}
            <span>{stage.room}</span>
          </span>
        ))}
      </div>

      <ToastBanner toast={toast} />

      <MetricsStrip metrics={snapshot.metrics} />

      <ControlPanel
        onRunCycle={runCycle}
        onRunPixel={runPixel}
        onResetDemo={resetDemo}
        running={running}
        runningPixel={runningPixel}
        resetting={resetting}
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <FactoryMap
            agents={snapshot.agents}
            pendingReviews={snapshot.metrics.pendingReviews}
          />
        </div>
        <AgentStatusPanel
          agents={snapshot.agents}
          tasksById={snapshot.tasksById}
        />
      </div>

      <EventFeed events={snapshot.events} />
    </div>
  );
}

function FactoryAuthCallout({
  title,
  body,
  href,
  hrefLabel,
}: {
  title: string;
  body: string;
  href?: string;
  hrefLabel?: string;
}) {
  return (
    <div className="factory-panel panel-glow-orange max-w-xl">
      <h1 className="text-xl font-bold">{title}</h1>
      <p className="mt-2 text-sm text-[var(--text-muted)]">{body}</p>
      {href && hrefLabel && (
        <Link
          href={href}
          className="mt-4 inline-flex text-sm font-semibold text-[var(--accent-blue)] hover:underline"
        >
          {hrefLabel} →
        </Link>
      )}
    </div>
  );
}
