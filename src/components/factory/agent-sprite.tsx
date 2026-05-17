"use client";

import {
  getAgentActivityLine,
  getAgentDisplayName,
} from "@/lib/ajax/constants";
import type { AgentSlug } from "@/lib/ajax/types";
import type { AgentStatus } from "@/lib/ajax/status";

const SLUG_STYLES: Record<
  AgentSlug,
  { body: string; glow: string; letter: string }
> = {
  nova: {
    body: "bg-[var(--accent-blue)]/25 border-[var(--accent-blue)]",
    glow: "shadow-[0_0_24px_-6px_var(--accent-blue-glow)]",
    letter: "N",
  },
  forge: {
    body: "bg-[var(--accent-orange)]/25 border-[var(--accent-orange)]",
    glow: "shadow-[0_0_24px_-6px_var(--accent-orange-glow)]",
    letter: "F",
  },
  pixel: {
    body: "bg-cyan-400/25 border-cyan-400",
    glow: "shadow-[0_0_24px_-6px_rgba(34,211,238,0.4)]",
    letter: "P",
  },
};

const STATUS_CLASS: Record<AgentStatus, string> = {
  idle: "agent-sprite-idle",
  thinking: "agent-sprite-thinking",
  working: "agent-sprite-working",
  waiting_review: "agent-sprite-waiting",
  error: "agent-sprite-error",
};

type AgentSpriteProps = {
  slug: AgentSlug;
  status: AgentStatus;
  compact?: boolean;
};

export function AgentSprite({ slug, status, compact }: AgentSpriteProps) {
  const style = SLUG_STYLES[slug];
  const size = compact ? "h-10 w-10 text-sm" : "h-14 w-14 text-lg";
  const activity = getAgentActivityLine(slug, status);

  return (
    <div
      className={`agent-sprite ${STATUS_CLASS[status]} ${style.glow} flex flex-col items-center gap-1`}
      title={`${getAgentDisplayName(slug)} — ${activity}`}
    >
      <div
        className={`agent-sprite-body ${size} flex items-center justify-center rounded-md border-2 font-bold ${style.body}`}
      >
        {style.letter}
      </div>
      {!compact && (
        <>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--foreground)]">
            {getAgentDisplayName(slug)}
          </span>
          <span className="max-w-[8rem] text-center text-[9px] leading-tight text-[var(--accent-blue)]">
            {activity}
          </span>
        </>
      )}
    </div>
  );
}
