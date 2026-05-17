"use client";

import { AgentSprite } from "@/components/factory/agent-sprite";
import type { AgentMemoryProfile } from "@/lib/ajax/agent-memory";
import { AGENT_MICROCOPY } from "@/lib/ajax/constants";
import type { AgentSlug } from "@/lib/ajax/types";
import { StatusBadge } from "@/components/ui/status-badge";

const SLUG_ACCENT: Record<AgentSlug, "blue" | "orange"> = {
  nova: "blue",
  forge: "orange",
  pixel: "blue",
};

function formatWhen(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function feedbackTone(type: string): "blue" | "orange" | "neutral" | "warning" {
  if (type === "approval_note") return "blue";
  if (type === "rejection") return "warning";
  return "neutral";
}

function feedbackLabel(type: string) {
  if (type === "approval_note") return "Approval";
  if (type === "rejection") return "Rejection";
  return type.replace(/_/g, " ");
}

type AgentMemoryCardProps = {
  profile: AgentMemoryProfile;
};

export function AgentMemoryCard({ profile }: AgentMemoryCardProps) {
  const accent = SLUG_ACCENT[profile.slug];
  const glow = accent === "orange" ? "panel-glow-orange" : "panel-glow-blue";

  return (
    <article className={`factory-panel ${glow} flex flex-col gap-4`}>
      <header className="flex flex-col items-center text-center sm:items-start sm:text-left">
        <AgentSprite slug={profile.slug} status="idle" compact />
        <div className="mt-3 w-full">
          <StatusBadge label={profile.role} tone={accent} />
          <h2 className="mt-2 text-xl font-bold">{profile.displayName}</h2>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
            agent.{profile.slug} · memory v1
          </p>
          <p className="factory-room-tagline mt-1 not-italic">
            {AGENT_MICROCOPY[profile.slug]}
          </p>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 text-center">
        <StatBox label="Approvals" value={profile.approvalCount} tone="blue" />
        <StatBox label="Rejections" value={profile.rejectionCount} tone="orange" />
      </div>

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
          Learning notes
        </h3>
        {profile.learningNotes.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            No notes yet — approve or reject listings to teach this agent.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {profile.learningNotes.map((note) => (
              <li
                key={note.id}
                className="rounded border border-[var(--accent-blue)]/20 bg-[var(--accent-blue)]/5 px-3 py-2 text-sm"
              >
                {note.note}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
          Recent human feedback
        </h3>
        {profile.recentFeedback.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--text-muted)]">No feedback recorded.</p>
        ) : (
          <ul className="mt-2 max-h-56 space-y-2 overflow-y-auto pr-1">
            {profile.recentFeedback.map((item) => (
              <li
                key={item.id}
                className="rounded border border-[var(--border-dim)] bg-black/20 p-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <StatusBadge
                    label={feedbackLabel(item.feedbackType)}
                    tone={feedbackTone(item.feedbackType)}
                  />
                  <time className="text-[10px] text-[var(--text-muted)]">
                    {formatWhen(item.createdAt)}
                  </time>
                </div>
                <p className="mt-2 text-sm leading-snug">{item.feedbackText}</p>
                {item.listingTitle && (
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    Listing: {item.listingTitle}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="mt-auto border-t border-[var(--border-dim)] pt-3">
        <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
          LLM prompt bundle (preview)
        </p>
        <pre className="mt-2 max-h-32 overflow-auto rounded bg-black/30 p-2 font-mono text-[10px] leading-relaxed text-[var(--text-muted)]">
          {profile.promptContext.learningNotes.length
            ? profile.promptContext.learningNotes.map((n) => `• ${n}`).join("\n")
            : "• (empty memory)"}
        </pre>
      </footer>
    </article>
  );
}

function StatBox({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "blue" | "orange";
}) {
  return (
    <div
      className={`rounded border border-[var(--border-dim)] p-2 ${
        tone === "orange"
          ? "border-l-2 border-l-[var(--accent-orange)]"
          : "border-l-2 border-l-[var(--accent-blue)]"
      }`}
    >
      <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
        {label}
      </p>
      <p className="font-mono text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}
