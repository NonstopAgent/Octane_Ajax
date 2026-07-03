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

type DashAgent = RevenueDashboardData["agents"][number];

const FACTORY_AGENTS: AgentSlug[] = ["nova", "forge", "pixel"];

const AGENT_ROLE: Record<string, string> = {
  nova: "Research",
  forge: "Creation",
  pixel: "Marketing",
};

const THIS_WEEK_METRICS = [
  { key: "productsGenerated" as const, label: "Generated" },
  { key: "passedQualityGate" as const, label: "Passed QC" },
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

function formatUsd(value: number): string {
  const n = Number.isFinite(value) ? value : 0;
  return n > 0 && n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`;
}

function formatCents(cents: number): string {
  const dollars = (Number.isFinite(cents) ? cents : 0) / 100;
  return `$${dollars.toFixed(2)}`;
}

// ─── Hero KPI band ──────────────────────────────────────────────────────────

function KpiTile({
  label,
  value,
  accent = "var(--foreground)",
  sub,
}: {
  label: string;
  value: string | number;
  accent?: string;
  sub?: string;
}) {
  return (
    <div className="flex flex-col gap-1 px-4 py-1 first:pl-0">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
        {label}
      </p>
      <p
        className="font-mono text-3xl font-bold tabular-nums sm:text-4xl"
        style={{ color: accent }}
      >
        {value}
      </p>
      {sub ? (
        <p className="text-[10px] text-[var(--text-muted)]/70">{sub}</p>
      ) : null}
    </div>
  );
}

function KpiBand({ dashboard }: { dashboard: RevenueDashboardData }) {
  const revenue = formatCents(dashboard.performance.revenueCentsThisWeek);
  const orders = dashboard.performance.ordersThisWeek;

  return (
    <section
      className="factory-panel panel-glow-blue grid grid-cols-2 gap-y-4 divide-[var(--border-dim)] sm:grid-cols-4 sm:divide-x"
      aria-label="This week at a glance"
    >
      <KpiTile label="Revenue · 7d" value={revenue} accent="#34d399" />
      <KpiTile label="Orders · 7d" value={orders} accent="var(--accent-blue)" />
      <KpiTile label="Live on Etsy" value={dashboard.thisWeek.liveOnEtsy} />
      <KpiTile
        label="LLM cost · 7d"
        value={formatUsd(dashboard.thisWeek.costThisWeekUsd)}
        accent="var(--accent-orange)"
      />
    </section>
  );
}

// ─── Agent strip ────────────────────────────────────────────────────────────

function AgentStrip({
  agentsBySlug,
}: {
  agentsBySlug: Record<string, DashAgent | undefined>;
}) {
  return (
    <section aria-label="Agent status">
      <div className="mb-2 flex items-center gap-2">
        <span className="pipeline-ribbon text-[11px]">
          <span>Nova</span>
          <span className="arrow">→</span>
          <span>Forge</span>
          <span className="arrow">→</span>
          <span>Pixel</span>
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
          pipeline
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {FACTORY_AGENTS.map((slug) => {
          const agent = agentsBySlug[slug];
          const status = agent?.status ?? "offline";
          return (
            <div
              key={slug}
              className="flex items-center gap-3 rounded-md border border-[var(--border-dim)] bg-black/25 p-3"
            >
              <div className="shrink-0">
                {agent ? (
                  <AgentSprite slug={slug} status={agent.status} />
                ) : (
                  <div className="factory-logo-mark opacity-30" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--foreground)]">
                  {getAgentDisplayName(slug)}
                </p>
                <p className="text-[11px] text-[var(--text-muted)]">
                  {AGENT_ROLE[slug]} · {status}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── Production + funnel ────────────────────────────────────────────────────

function ProductionRow({ dashboard }: { dashboard: RevenueDashboardData }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {THIS_WEEK_METRICS.map((item) => (
        <div key={item.key} className="factory-metric command-metric">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
            {item.label}
          </p>
          <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-[var(--foreground)]">
            {dashboard.thisWeek[item.key]}
          </p>
        </div>
      ))}
    </div>
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
                className="h-8 rounded-sm bg-[var(--accent-blue)]/15"
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

// ─── Performance ────────────────────────────────────────────────────────────

function PerformanceSection({
  performance,
}: {
  performance: RevenueDashboardData["performance"];
}) {
  if (!performance.hasData) return null;
  if (
    performance.topByViewVelocity.length === 0 &&
    performance.highViewsZeroOrders.length === 0
  ) {
    return null;
  }

  return (
    <section className="factory-panel" aria-label="Etsy performance">
      <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent-blue)]">
        Etsy performance
      </h2>
      <p className="mt-1 text-[10px] text-[var(--text-muted)]">
        Live views, favorites &amp; sales · last 7 days
      </p>

      <div className="mt-4 grid gap-6 sm:grid-cols-2">
        {performance.topByViewVelocity.length > 0 && (
          <div>
            <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
              Top listings by view velocity
            </p>
            <ul className="space-y-1.5">
              {performance.topByViewVelocity.map((l) => (
                <li
                  key={l.etsyListingId}
                  className="flex items-baseline justify-between gap-3 text-sm"
                >
                  <span className="truncate text-[var(--foreground)]">
                    {l.title}
                  </span>
                  <span className="shrink-0 font-mono text-[var(--accent-blue)]">
                    +{l.viewsGained} views
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {performance.highViewsZeroOrders.length > 0 && (
          <div>
            <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--accent-orange)]">
              Traffic but no sales — revise title or price
            </p>
            <ul className="space-y-1.5">
              {performance.highViewsZeroOrders.map((l) => (
                <li
                  key={l.etsyListingId}
                  className="flex items-baseline justify-between gap-3 text-sm"
                >
                  <span className="truncate text-[var(--foreground)]">
                    {l.title}
                  </span>
                  <span className="shrink-0 font-mono text-[var(--text-muted)]">
                    {l.latestViews} views · 0 orders
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function RecentActivityTimeline({ events }: { events: FactoryEvent[] }) {
  return (
    <section className="factory-panel">
      <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent-blue)]">
        Recent activity
      </h2>
      <p className="mt-1 text-[10px] text-[var(--text-muted)]">
        Last {events.length || 0} factory events
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

// ─── Page ───────────────────────────────────────────────────────────────────

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
        description="Revenue, agent status, and this week’s output across Nova → Forge → Review → Pixel."
        aside={
          <ButtonLink href="/factory" variant="primary">
            Open factory floor
          </ButtonLink>
        }
        sysline="SYS.AJAX.REV :: TELEMETRY"
      />

      <KpiBand dashboard={dashboard} />

      <AgentStrip agentsBySlug={agentsBySlug} />

      {hasActivity ? (
        <>
          <section aria-label="This week output">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
              This week · production
            </p>
            <ProductionRow dashboard={dashboard} />
          </section>

          <PipelineFunnelBar funnel={dashboard.funnel} />
          <PerformanceSection performance={dashboard.performance} />
          <RecentActivityTimeline events={dashboard.recentEvents} />
        </>
      ) : (
        <section className="factory-panel panel-glow-blue text-center py-10">
          <p className="text-lg font-semibold">Ready to run your first cycle</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--text-muted)]">
            Head to the factory floor and hit <strong>Run Ajax cycle</strong>. Nova
            searches Etsy for demand signals and generates ideas, Forge builds a
            listing, and it lands in the review gate.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <ButtonLink href="/factory" variant="primary">
              Go to factory floor →
            </ButtonLink>
            <ButtonLink href="/review" variant="secondary">
              Review gate
            </ButtonLink>
          </div>
        </section>
      )}

      <p className="text-center text-xs text-[var(--text-muted)]">
        <Link href="/factory" className="text-[var(--accent-blue)] hover:underline">
          Open factory floor →
        </Link>
      </p>
    </div>
  );
}
