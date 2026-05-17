"use client";

import { RoomStation } from "@/components/factory/room-station";
import { PIPELINE_STAGES, ROOM_SLUGS } from "@/lib/ajax/constants";
import type { AjaxAgent } from "@/lib/ajax/types";
import type { RoomSlug } from "@/lib/ajax/types";

type FactoryMapProps = {
  agents: AjaxAgent[];
  pendingReviews: number;
};

function agentsInRoom(agents: AjaxAgent[], roomSlug: RoomSlug) {
  return agents.filter((a) => a.currentRoom === roomSlug);
}

export function FactoryMap({ agents, pendingReviews }: FactoryMapProps) {
  const forgeAtReview = agents.some(
    (a) =>
      a.slug === "forge" &&
      a.status === "waiting_review" &&
      a.currentRoom === ROOM_SLUGS.REVIEW_GATE,
  );

  return (
    <section className="factory-panel panel-glow-blue p-0 overflow-hidden">
      <div className="border-b border-[var(--border-dim)] px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent-blue)]">
          Factory map
        </h2>
        <p className="text-sm text-[var(--text-muted)]">
          Live floor — agents move between stations as the pipeline runs
        </p>
      </div>

      <div className="factory-map-grid p-4">
        {PIPELINE_STAGES.map((stage) => {
          const roomAgents = agentsInRoom(agents, stage.roomSlug);
          const isReview = stage.id === "review";
          const humanPresent =
            isReview && (pendingReviews > 0 || forgeAtReview);

          return (
            <RoomStation
              key={stage.id}
              stageId={stage.id}
              roomSlug={stage.roomSlug}
              label={stage.room}
              agents={roomAgents}
              humanPresent={humanPresent}
              highlight={isReview && pendingReviews > 0}
            />
          );
        })}
      </div>

      <div className="border-t border-[var(--border-dim)] bg-black/20 px-4 py-2">
        <p className="font-mono text-[10px] text-[var(--text-muted)]">
          PIPELINE :: NOVA → FORGE → REVIEW → PIXEL → STOREFRONT
        </p>
      </div>
    </section>
  );
}
