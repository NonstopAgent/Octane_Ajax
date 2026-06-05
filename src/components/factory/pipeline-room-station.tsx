"use client";

import { AgentSprite } from "@/components/factory/agent-sprite";
import {
  getStationMicrocopy,
  REVIEW_GATE_MICROCOPY,
} from "@/lib/ajax/constants";
import type { PipelineStageId } from "@/lib/ajax/constants";
import { getRoomDisplayName } from "@/lib/ajax/constants";
import type { AgentSlug, AjaxAgent } from "@/lib/ajax/types";
import type { RoomSlug } from "@/lib/ajax/types";

type PipelineRoomStationProps = {
  stageId: PipelineStageId;
  roomSlug: RoomSlug;
  label: string;
  agents: AjaxAgent[];
  humanPresent?: boolean;
  highlight?: boolean;
};

/** Pipeline floor map station — agents per room (Room 1 pipeline). */
export function PipelineRoomStation({
  stageId,
  roomSlug,
  label,
  agents,
  humanPresent,
  highlight,
}: PipelineRoomStationProps) {
  const active = agents.some(
    (a) => a.status === "working" || a.status === "thinking",
  );
  const waiting = agents.some((a) => a.status === "waiting_review");
  const tagline =
    stageId === "review"
      ? REVIEW_GATE_MICROCOPY
      : getStationMicrocopy(
          stageId,
          agents.map((a) => ({ slug: a.slug, status: a.status })),
        );

  return (
    <article
      className={`factory-room ${active ? "factory-room-active" : ""} ${waiting || highlight ? "factory-room-alert" : ""}`}
      data-stage={stageId}
    >
      <header className="factory-room-header">
        <span className="factory-room-led" aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-[var(--foreground)]">{label}</h3>
          <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
            {getRoomDisplayName(roomSlug)}
          </p>
          <p className="factory-room-tagline">{tagline}</p>
        </div>
      </header>

      <div className="factory-room-floor">
        {agents.length === 0 && !humanPresent && (
          <p className="text-xs text-[var(--text-muted)]">Station clear</p>
        )}

        {agents.map((agent) => (
          <AgentSprite
            key={agent.id}
            slug={agent.slug as AgentSlug}
            status={agent.status}
            compact={agents.length > 1}
          />
        ))}

        {humanPresent && (
          <div className="human-sprite" title={REVIEW_GATE_MICROCOPY}>
            <span className="human-sprite-icon">QC</span>
            <span className="text-[10px] font-semibold uppercase text-[var(--accent-orange)]">
              Operator
            </span>
          </div>
        )}
      </div>
    </article>
  );
}
