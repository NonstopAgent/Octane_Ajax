import { AGENTS } from "@/lib/constants";

type Agent = (typeof AGENTS)[number];

type AgentCardProps = {
  agent: Agent;
  status?: "idle" | "working" | "waiting";
};

const accentRing = {
  blue: "ring-[var(--accent-blue)]/40 shadow-[0_0_24px_-4px_var(--accent-blue-glow)]",
  orange:
    "ring-[var(--accent-orange)]/40 shadow-[0_0_24px_-4px_var(--accent-orange-glow)]",
};

const statusLabel = {
  idle: "Standby",
  working: "Active",
  waiting: "Awaiting input",
};

export function AgentCard({ agent, status = "idle" }: AgentCardProps) {
  return (
    <article
      className={`factory-panel ring-1 ${accentRing[agent.accent]} p-4 transition-shadow`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
            {agent.station}
          </p>
          <h3 className="mt-1 text-lg font-bold text-[var(--foreground)]">
            {agent.name}
          </h3>
          <p
            className={
              agent.accent === "orange"
                ? "text-sm text-[var(--accent-orange)]"
                : "text-sm text-[var(--accent-blue)]"
            }
          >
            {agent.role}
          </p>
        </div>
        <span
          className={`status-pill status-${status}`}
          aria-label={`Status: ${statusLabel[status]}`}
        >
          {statusLabel[status]}
        </span>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-[var(--text-muted)]">
        {agent.description}
      </p>
    </article>
  );
}
