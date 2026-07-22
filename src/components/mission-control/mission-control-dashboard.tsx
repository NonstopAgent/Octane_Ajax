"use client";

/**
 * Mission Control — the machine, visible. Agent heartbeats, the autopilot
 * pulse, the production line, spend, and the live activity feed on one
 * screen, refreshed every 60s.
 *
 * Deliberately NO "needs your call" panel (operator decision, 2026-07-20):
 * this page proves the system is working, it does not assign chores.
 */

import { useCallback, useEffect, useState } from "react";
import { CommandHeader } from "@/components/layout/command-header";
import { Button, ButtonLink } from "@/components/ui/button";

type Snapshot = {
  ok: boolean;
  error?: string;
  generatedAt: string;
  agents: {
    slug: string;
    name: string;
    status: string;
    room: string | null;
    lastHeartbeat: string | null;
    currentTask: string | null;
    tasksCompleted7d: number;
    lastCompletedAt: string | null;
  }[];
  autopilot: {
    lastPassAt: string | null;
    passes24h: number;
    lastSummary: string | null;
    lastSummaryAt: string | null;
  };
  production: {
    listingsByStatus: Record<string, number>;
    pendingReviews: number;
    operatorSeedsWaiting: number;
  };
  spend: {
    llmCostToday: number;
    llmCost7d: number;
    videoRendersToday: number;
    videoDailyCap: number;
  };
  performance: {
    snapshotDate: string;
    views: number;
    favorites: number;
    orders: number;
    revenueCents: number;
  } | null;
  feed: { type: string; message: string; at: string; agent: string | null }[];
};

const STATUS_STYLES: Record<string, string> = {
  working: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  idle: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  waiting: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  error: "bg-red-500/15 text-red-400 border-red-500/30",
  offline: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
};

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-lg font-semibold text-zinc-100">{value}</div>
      <div className="text-xs text-zinc-500">{label}</div>
    </div>
  );
}

export function MissionControlDashboard() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/ajax/mission-control", {
        credentials: "include",
      });
      const data = (await res.json()) as Snapshot;
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Failed to load the snapshot.");
        return;
      }
      setSnap(data);
      setError(null);
    } catch {
      setError("Network error while loading mission control.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div className="space-y-6">
      <CommandHeader
        badge="Live operations"
        title="Mission Control"
        description="What the autonomous system is doing right now — heartbeats, the hourly autopilot pulse, the production line, and what it costs. Refreshes every minute."
        aside={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" disabled={loading} onClick={() => void load()}>
              {loading ? "Refreshing…" : "Refresh"}
            </Button>
            <ButtonLink href="/factory" variant="secondary">
              Factory floor
            </ButtonLink>
          </div>
        }
        sysline="SYS.AJAX.OPS :: AUTONOMOUS"
      />

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {snap && (
        <>
          {/* Agent heartbeats */}
          <div className="grid gap-4 md:grid-cols-3">
            {snap.agents.map((agent) => (
              <Card key={agent.slug} title={agent.name || agent.slug}>
                <div className="flex items-center justify-between">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[agent.status] ?? STATUS_STYLES.offline}`}
                  >
                    {agent.status}
                  </span>
                  <span className="text-xs text-zinc-500">
                    ♥ {timeAgo(agent.lastHeartbeat)}
                  </span>
                </div>
                <div className="mt-3 space-y-1 text-sm text-zinc-300">
                  <div>
                    <span className="text-zinc-500">Now: </span>
                    {agent.currentTask ?? "—"}
                  </div>
                  <div>
                    <span className="text-zinc-500">Room: </span>
                    {agent.room ?? "—"}
                  </div>
                  <div>
                    <span className="text-zinc-500">Done (7d): </span>
                    {agent.tasksCompleted7d}
                    {agent.lastCompletedAt
                      ? ` · last ${timeAgo(agent.lastCompletedAt)}`
                      : ""}
                  </div>
                </div>
              </Card>
            ))}
          </div>

          {/* Pulse / production / spend / shop */}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card title="Autopilot pulse">
              <div className="grid grid-cols-2 gap-3">
                <Stat label="last pass" value={timeAgo(snap.autopilot.lastPassAt)} />
                <Stat label="passes / 24h" value={String(snap.autopilot.passes24h)} />
              </div>
              {snap.autopilot.lastSummary && (
                <p className="mt-3 line-clamp-3 text-xs text-zinc-400">
                  {snap.autopilot.lastSummary}
                </p>
              )}
            </Card>

            <Card title="Production line">
              <div className="grid grid-cols-2 gap-3">
                <Stat
                  label="published"
                  value={String(snap.production.listingsByStatus.published ?? 0)}
                />
                <Stat
                  label="in review"
                  value={String(snap.production.pendingReviews)}
                />
                <Stat
                  label="seeds queued"
                  value={String(snap.production.operatorSeedsWaiting)}
                />
                <Stat
                  label="rejected (all time)"
                  value={String(snap.production.listingsByStatus.rejected ?? 0)}
                />
              </div>
            </Card>

            <Card title="Spend">
              <div className="grid grid-cols-2 gap-3">
                <Stat label="LLM today" value={`$${snap.spend.llmCostToday.toFixed(2)}`} />
                <Stat label="LLM 7 days" value={`$${snap.spend.llmCost7d.toFixed(2)}`} />
                <Stat
                  label="video renders today"
                  value={`${snap.spend.videoRendersToday}/${snap.spend.videoDailyCap}`}
                />
              </div>
            </Card>

            <Card title="Shop (latest snapshot)">
              {snap.performance ? (
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="views" value={String(snap.performance.views)} />
                  <Stat label="favorites" value={String(snap.performance.favorites)} />
                  <Stat label="orders" value={String(snap.performance.orders)} />
                  <Stat
                    label="revenue"
                    value={`$${(snap.performance.revenueCents / 100).toFixed(2)}`}
                  />
                </div>
              ) : (
                <p className="text-sm text-zinc-500">
                  No performance snapshots yet — they appear once Etsy analytics
                  sync runs.
                </p>
              )}
            </Card>
          </div>

          {/* Activity feed */}
          <Card title="Latest activity">
            <ul className="divide-y divide-zinc-800">
              {snap.feed.map((e, i) => (
                <li key={`${e.at}-${i}`} className="flex gap-3 py-2 text-sm">
                  <span className="w-20 shrink-0 text-xs text-zinc-500">
                    {timeAgo(e.at)}
                  </span>
                  <span className="w-24 shrink-0 truncate text-xs uppercase tracking-wide text-zinc-600">
                    {e.type.replace(/_/g, " ")}
                  </span>
                  <span className="text-zinc-300">{e.message}</span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
