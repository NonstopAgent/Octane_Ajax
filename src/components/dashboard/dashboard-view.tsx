"use client";

import Link from "next/link";
import { AgentSprite } from "@/components/factory/agent-sprite";
import { CommandHeader } from "@/components/layout/command-header";
import { getAgentDisplayName } from "@/lib/ajax/constants";
import { getFactoryEventMessage } from "@/lib/ajax/helpers";
import type { PipelineFunnel } from "@/lib/factory/revenue-queries";
import type { RevenueDashboardData } from "@/lib/factory/revenue-types";
import type { AgentSlug } from "@/lib/ajax/types";
import type { FactoryEvent } from "@/lib/ajax/types";
import { ButtonLink } from "@/components/ui/button";

type DashboardViewProps = {
  dashboard: RevenueDashboardData;
  isAuthenticated: boolean;
  configReady: boolean;
};

const FACTORY_AGENTS: AgentSlug[] = ["nova", "forge", "pixel"];

const THIS_WEEK_METRICS = [
  { key: "productsGenerated" as const, label: "Products Generated" },
  { key: "passedQualityGate" as const, label: "Passed Quality Gate" },
  { key: "approved" as const, label: "Approved" },
  { key: "liveOnEtsy" as const, label: "Live on Etsy" },
];

const FUNNEL_STAGES: { key: keyof PipelineFunnel; label: string }[] = [
  { key: "ideas", label: "Ideas" },
  { key: "passed", label: "Passed" },
  { key: "approved", label: "Approved" },
  { key: "published", label: "Published" },
];

function formatTimeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "unknown";

  const seconds = Math.floor((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function formatEventType(eventType: string): string {
  return eventType.replace(/_/g, ".");
}

function RecentActivityTimeline({ events }: { events: FactoryEvent[] }) {
  return (
    <section className="factory-panel">
      <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent-blue)]">
        Recent activity
      </h2>
      <p className="mt-1 text-[10px] text-[var(--text-muted)]">
        Last 8 factory events
      </p>
      <ul className="mt-4 space-y-3">
        {events.length === 0 && (
          <li className="text-sm text-[var(--text-muted)]">
            No events yet. Run a cycle from the factory floor.
          </li>
        )}
        {events.map((event) => (
          <li
            key={event.id}
            className="border-l-2 border-[var(--accent-blue)]/40 pl-3"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-mono text-[11px] uppercase tracking-wide text-[var(--accent-orange)]">
                {formatEventType(event.eventType)}
              </span>
              <span className="text-[10px] text-[var(--text-muted)]">
                {formatTimeAgo(event.createdAt)}
              </span>
            </div>
            <p className="mt-1 text-sm text-[var(--foreground)]">
              {getFactoryEventMessage(event)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PipelineFunnelBar({ funnel }: { funnel: PipelineFunnel }) {
  const max = Math.max(...FUNNEL_STAGES.map((s) => funnel[s.key]), 1);

  return (
    <section className="factory-panel" aria-label="Pipeline funnel">
      <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)]">
        Pipeline funnel
      </h2>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-2">
        {FUNNEL_STAGES.map((stage, index) => {
          const value = funnel[stage.key];
          const widthPct = Math.max(8, Math.round((value / max) * 100));
          return (
            <div key={stage.key} className="flex min-w-0 flex-1 flex-col">
              <div className="mb-1 flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                <span>{stage.label}</span>
                <span className="font-mono text-[var(--foreground)]">{value}</span>
              </div>
              <div
                className="h-8 rounded-sm bg-[var(--accent-blue)]/25"
                title={`${stage.label}: ${value}`}
              >
                <div
                  className="flex h-full items-center justify-center rounded-sm bg-[var(--accent-blue)] font-mono text-xs font-bold text-black"
                  style={{ width: `${widthPct}%`, minWidth: value > 0 ? "2rem" : 0 }}
                >
                  {value > 0 ? value : null}
                </div>
              </div>
              {index < FUNNEL_STAGES.length - 1 && (
                <span className="mt-2 hidden text-center text-[var(--text-muted)] sm:block">
                  →
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function DashboardView({
  dashboard,
  isAuthenticated,
  configReady,
}: DashboardViewProps) {
  if (!configReady) {
    return (
      <div className="factory-panel max-w-xl">
        <h1 className="text-xl font-bold">Configure Supabase</h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Add env vars to activate the command center.
        </p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="factory-panel max-w-xl">
        <h1 className="text-xl font-bold">Sign in required</h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Sign in to load live factory telemetry for your account.
        </p>
        <ButtonLink href="/login?next=/dashboard" variant="primary" className="mt-4">
          Sign in
        </ButtonLink>
      </div>
    );
  }

  const agentsBySlug = Object.fromEntries(
    dashboard.agents.map((a) => [a.slug, a]),
  );

  const hasActivity =
    dashboard.recentEvents.length > 0 ||
    Object.values(dashboard.thisWeek).some((v) => v > 0);

  return (
    <div className="space-y-6">
      <CommandHeader
        badge="Command center"
        title="Pipeline overview"
        description="Agent status, pipeline output, and this week’s activity across Nova → Forge → Review → Pixel."
        aside={
          <ButtonLink href="/factory" variant="primary">
            Open factory floor
          </ButtonLink>
        }
        sysline="SYS.AJAX.REV :: TELEMETRY"
      />

      {!hasActivity && (
        <section className="factory-panel panel-glow-blue text-center py-10">
          <p className="text-lg font-semibold">Ready to run your first cycle</p>
          <p className="mt-2 text-sm text-[var(--text-muted)] max-w-md mx-auto">
            Go to the factory floor and hit <strong>Run Ajax cycle</strong>. Nova will search Etsy for demand signals, generate product ideas, and Forge will build a listing. It lands here in the review gate.
          </p>
          <div className="mt-6 flex justify-center gap-3 flex-wrap">
            <ButtonLink href="/factory" variant="primary">
              Go to factory floor →
            </ButtonLink>
            <ButtonLink href="/review" variant="secondary">
              Review gate
            </ButtonLink>
          </div>
        </section>
      )}

      <section className="factory-panel panel-glow-blue">
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent-blue)]">
          Agent status
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {FACTORY_AGENTS.map((slug) => {
            const agent = agentsBySlug[slug];
            return (
              <div
                key={slug}
                className="flex flex-col items-center rounded-md border border-[var(--border-dim)] bg-black/25 p-4"
              >
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  {getAgentDisplayName(slug)}
                </p>
                {agent ? (
                  <AgentSprite slug={slug} status={agent.status} />
                ) : (
                  <p className="text-xs text-[var(--text-muted)]">Offline</p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {hasActivity && (
        <>
          <section aria-label="This week metrics">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
              This week
            </p>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {THIS_WEEK_METRICS.map((item) => (
                <div key={item.key} className="factory-metric command-metric">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                    {item.label}
                  </p>
                  <p className="mt-1 font-mono text-3xl font-bold tabular-nums text-[var(--foreground)]">
                    {dashboard.thisWeek[item.key]}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <PipelineFunnelBar funnel={dashboard.funnel} />
        </>
      )}

      <RecentActivityTimeline events={dashboard.recentEvents} />

      <p className="text-center text-xs text-[var(--text-muted)]">
        <Link href="/factory" className="text-[var(--accent-blue)] hover:underline">
          Open factory floor →
        </Link>
      </p>
    </div>
  );
}
