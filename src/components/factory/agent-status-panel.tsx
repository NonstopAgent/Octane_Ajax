"use client";

import {
  AGENT_SLUGS,
  getAgentDisplayName,
  getRoomDisplayName,
} from "@/lib/ajax/constants";
import { getStatusLabel } from "@/lib/ajax/status";
import type { AgentSlug, AjaxAgent, AjaxTask } from "@/lib/ajax/types";

const SLUG_ORDER: AgentSlug[] = [
  AGENT_SLUGS.NOVA,
  AGENT_SLUGS.FORGE,
  AGENT_SLUGS.PIXEL,
];

function formatHeartbeat(iso: string | null) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type AgentStatusPanelProps = {
  agents: AjaxAgent[];
  tasksById: Record<string, AjaxTask>;
};

export function AgentStatusPanel({ agents, tasksById }: AgentStatusPanelProps) {
  const bySlug = Object.fromEntries(agents.map((a) => [a.slug, a])) as Partial<
    Record<AgentSlug, AjaxAgent>
  >;

  return (
    <section className="factory-panel">
      <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)]">
        Agent status
      </h2>

      <ul className="mt-4 space-y-3">
        {SLUG_ORDER.map((slug) => {
          const agent = bySlug[slug];
          const task =
            agent?.currentTaskId && tasksById[agent.currentTaskId]
              ? tasksById[agent.currentTaskId]
              : null;

          if (!agent) {
            return (
              <li key={slug} className="agent-status-card opacity-50">
                <p className="font-semibold">{getAgentDisplayName(slug)}</p>
                <p className="text-xs text-[var(--text-muted)]">Not loaded</p>
              </li>
            );
          }

          return (
            <li
              key={slug}
              className={`agent-status-card agent-status-${agent.status}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-bold text-[var(--foreground)]">
                    {agent.name}
                  </p>
                  <p className="text-xs text-[var(--accent-blue)]">
                    {agent.role}
                  </p>
                </div>
                <span className={`status-pill status-${pillClass(agent.status)}`}>
                  {getStatusLabel(agent.status)}
                </span>
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
                <dt className="text-[var(--text-muted)]">Room</dt>
                <dd className="font-medium">
                  {agent.currentRoom
                    ? getRoomDisplayName(agent.currentRoom)
                    : "—"}
                </dd>
                <dt className="text-[var(--text-muted)]">Task</dt>
                <dd className="font-mono truncate">
                  {task ? task.taskType : "—"}
                </dd>
                <dt className="text-[var(--text-muted)]">Heartbeat</dt>
                <dd>{formatHeartbeat(agent.lastHeartbeat)}</dd>
              </dl>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function pillClass(status: AjaxAgent["status"]) {
  if (status === "working" || status === "thinking") return "working";
  if (status === "waiting_review") return "waiting";
  if (status === "error") return "error";
  return "idle";
}
