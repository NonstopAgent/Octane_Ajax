"use client";

import {
  getAgentDisplayName,
  getRoomDisplayName,
} from "@/lib/ajax/constants";
import { getFactoryEventMessage } from "@/lib/ajax/helpers";
import type { FactoryEvent } from "@/lib/ajax/types";
import type { AgentSlug } from "@/lib/ajax/types";

function formatTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function EventFeed({ events }: { events: FactoryEvent[] }) {
  return (
    <section className="machine-log flex max-h-[28rem] flex-col">
      <header className="machine-log-header shrink-0">
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent-blue)]">
          Machine log
        </h2>
        <p className="text-[10px] text-[var(--text-muted)]">
          SYS.LOG :: newest first · realtime
        </p>
      </header>

      <ul className="machine-log-body min-h-0 flex-1 space-y-1">
        {events.length === 0 && (
          <li className="machine-log-line text-center text-[var(--text-muted)]">
            [idle] Awaiting factory events. Initiate Ajax cycle.
          </li>
        )}

        {events.map((event) => (
          <li key={event.id} className="machine-log-line">
            <p>
              <span className="machine-log-ts">[{formatTime(event.createdAt)}]</span>{" "}
              <span className="machine-log-tag">
                {event.eventType.replace(/_/g, ".")}
              </span>
            </p>
            <p className="mt-1 text-[var(--foreground)]">
              {getFactoryEventMessage(event)}
            </p>
            <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">
              {event.agentSlug
                ? getAgentDisplayName(event.agentSlug as AgentSlug)
                : "SYS"}
              {event.room ? ` @ ${getRoomDisplayName(event.room)}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
