import Link from "next/link";
import { AgentCard } from "@/components/ui/agent-card";
import { ButtonLink } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { AGENTS, FACTORY_STATIONS } from "@/lib/constants";

export default function HomePage() {
  return (
    <div className="factory-grid-bg flex min-h-full flex-col">
      <header className="border-b border-[var(--border-dim)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-6 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="factory-logo-mark" aria-hidden />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--accent-blue)]">
                Octane Ajax
              </p>
              <p className="text-sm text-[var(--text-muted)]">
                Autonomous e-commerce factory
              </p>
            </div>
          </div>
          <ButtonLink href="/login?next=/factory" variant="primary">
            Sign in to factory
          </ButtonLink>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-16 px-4 py-16 sm:px-6">
        <section className="max-w-3xl">
          <StatusBadge label="MVP foundation" tone="orange" />
          <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
            Your AI factory for{" "}
            <span className="text-[var(--accent-blue)]">research</span>,{" "}
            <span className="text-[var(--accent-orange)]">creation</span>, and{" "}
            <span className="text-[var(--accent-blue)]">marketing</span>.
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-[var(--text-muted)]">
            Octane Ajax is a multi-agent command center that moves product ideas
            through a pipeline—Nova researches, Forge builds listings, humans
            approve at the Review Gate, and Pixel schedules content. Watch the
            factory floor update in real time as agents work.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/factory">View factory floor</ButtonLink>
            <ButtonLink href="/review" variant="secondary">
              Review queue
            </ButtonLink>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold uppercase tracking-widest text-[var(--text-muted)]">
            Agent crew
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {AGENTS.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold uppercase tracking-widest text-[var(--text-muted)]">
            Factory stations
          </h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {FACTORY_STATIONS.map((station) => (
              <li key={station.id} className="station-tile">
                <p className="text-xs uppercase tracking-widest text-[var(--text-muted)]">
                  {station.agent}
                </p>
                <p className="mt-2 font-semibold">{station.name}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="factory-panel panel-glow-blue">
          <h2 className="text-lg font-semibold">Core product flow</h2>
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-[var(--text-muted)]">
            <li>Nova researches trends and creates product ideas.</li>
            <li>Forge selects a strong idea and creates a listing.</li>
            <li>The listing enters human review (pending_review).</li>
            <li>You approve or reject with feedback.</li>
            <li>Pixel creates and schedules marketing content.</li>
            <li>Every action is logged as a factory event.</li>
          </ol>
          <p className="mt-6 text-sm text-[var(--text-muted)]">
            Next up: Supabase pipeline, demo agent cycle, and live factory
            visualization.{" "}
            <Link
              href="/dashboard"
              className="text-[var(--accent-blue)] hover:underline"
            >
              Open dashboard →
            </Link>
          </p>
        </section>
      </main>
    </div>
  );
}
