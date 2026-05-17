"use client";

import Link from "next/link";
import { AgentSprite } from "@/components/factory/agent-sprite";
import { EventFeed } from "@/components/factory/event-feed";
import { MetricsStrip } from "@/components/factory/metrics-strip";
import { CommandHeader } from "@/components/layout/command-header";
import { PIPELINE_STAGES } from "@/lib/ajax/constants";
import type { FactorySnapshot } from "@/lib/factory/types";
import type { AgentSlug } from "@/lib/ajax/types";
import { ButtonLink } from "@/components/ui/button";

type DashboardViewProps = {
  snapshot: FactorySnapshot;
  isAuthenticated: boolean;
  configReady: boolean;
};

export function DashboardView({
  snapshot,
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
    snapshot.agents.map((a) => [a.slug, a]),
  );

  return (
    <div className="space-y-6">
      <CommandHeader
        badge="Command center"
        title="Autonomous factory overview"
        description="Telemetry from Nova, Forge, Pixel, and the human review gate — one glance at pipeline health."
        aside={
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/factory" variant="primary">
              Open factory floor
            </ButtonLink>
            <ButtonLink href="/review" variant="secondary">
              Quality control
            </ButtonLink>
          </div>
        }
        sysline="SYS.AJAX.CMD :: TELEMETRY"
      />

      <MetricsStrip metrics={snapshot.metrics} />

      <div className="pipeline-ribbon factory-panel py-3">
        {PIPELINE_STAGES.map((stage, i) => (
          <span key={stage.id} className="inline-flex items-center gap-1">
            {i > 0 && <span className="arrow">→</span>}
            <span>{stage.room}</span>
          </span>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="factory-panel panel-glow-blue lg:col-span-2">
          <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent-blue)]">
            Agent units
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {(["nova", "forge", "pixel"] as AgentSlug[]).map((slug) => {
              const agent = agentsBySlug[slug];
              return (
                <div
                  key={slug}
                  className="flex flex-col items-center rounded-md border border-[var(--border-dim)] bg-black/25 p-4"
                >
                  {agent ? (
                    <AgentSprite slug={slug} status={agent.status} />
                  ) : (
                    <p className="text-xs text-[var(--text-muted)]">Offline</p>
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-4 text-center text-xs text-[var(--text-muted)]">
            <Link href="/agents" className="text-[var(--accent-blue)] hover:underline">
              View agent memory →
            </Link>
          </p>
        </section>

        <section className="factory-panel">
          <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)]">
            Quick dispatch
          </h2>
          <ul className="mt-3 space-y-2 text-sm text-[var(--text-muted)]">
            <li>
              QC pending:{" "}
              <span className="font-mono text-[var(--accent-orange)]">
                {snapshot.metrics.pendingReviews}
              </span>
            </li>
            <li>
              Published:{" "}
              <span className="font-mono text-[var(--accent-blue)]">
                {snapshot.metrics.publishedListings}
              </span>
            </li>
          </ul>
          <ButtonLink href="/factory" variant="primary" className="mt-4 w-full">
            Run from factory floor
          </ButtonLink>
        </section>
      </div>

      <EventFeed events={snapshot.events.slice(0, 12)} />
    </div>
  );
}
