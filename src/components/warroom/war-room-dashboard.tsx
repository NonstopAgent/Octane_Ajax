"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CommandHeader } from "@/components/layout/command-header";
import { ButtonLink } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  ToastBanner,
  type ToastState,
  type ToastTone,
} from "@/components/factory/toast-banner";

type RecCategory = "niche" | "channel" | "pricing" | "cut" | "other";
type RecStatus = "proposed" | "accepted" | "dismissed" | "actioned";

type Recommendation = {
  id: string;
  category: RecCategory;
  title: string;
  rationale: string;
  recommendedAction: string;
  priority: number;
  confidence: number | null;
  status: RecStatus;
  draftedIdeaId: string | null;
  createdAt: string;
};

type WarRoomDashboardProps = {
  initialRecommendations: Recommendation[];
  isAuthenticated: boolean;
  configReady: boolean;
};

const CATEGORY_LABELS: Record<RecCategory, string> = {
  niche: "Niche & product strategy",
  channel: "Channel expansion",
  pricing: "Pricing & margins",
  cut: "Cut underperformers",
  other: "Other",
};

const CATEGORY_ORDER: RecCategory[] = [
  "niche",
  "channel",
  "pricing",
  "cut",
  "other",
];

function statusTone(
  status: RecStatus,
): "blue" | "orange" | "warning" | "neutral" {
  if (status === "accepted" || status === "actioned") return "blue";
  if (status === "dismissed") return "neutral";
  return "warning";
}

export function WarRoomDashboard({
  initialRecommendations,
  isAuthenticated,
  configReady,
}: WarRoomDashboardProps) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);

  const showToast = (tone: ToastTone, message: string) => {
    setToast({ tone, message });
    window.setTimeout(() => setToast(null), 6000);
  };

  const runWarRoom = async () => {
    setRunning(true);
    try {
      const res = await fetch("/api/ajax/war-room/run", {
        method: "POST",
        credentials: "include",
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        showToast("error", data.error ?? data.message ?? "War Room run failed.");
        return;
      }
      showToast("success", data.message ?? "War Room finished.");
      router.refresh();
    } catch {
      showToast("error", "Network error while running the War Room.");
    } finally {
      setRunning(false);
    }
  };

  const setStatus = async (id: string, status: RecStatus) => {
    setActingId(id);
    try {
      const res = await fetch("/api/ajax/war-room/update", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        showToast("error", data.error ?? "Update failed.");
        return;
      }
      showToast("success", `Marked ${status}.`);
      router.refresh();
    } catch {
      showToast("error", "Network error during update.");
    } finally {
      setActingId(null);
    }
  };

  if (!configReady) {
    return (
      <Callout
        title="Supabase not configured"
        body="Add Supabase env vars to .env.local to use the War Room."
      />
    );
  }

  if (!isAuthenticated) {
    return (
      <Callout
        title="Sign in required"
        body="Sign in to view War Room strategy."
        href="/login?next=/war-room"
        hrefLabel="Sign in"
      />
    );
  }

  const active = initialRecommendations.filter((r) => r.status !== "dismissed");
  const grouped = CATEGORY_ORDER.map((cat) => ({
    cat,
    items: active
      .filter((r) => r.category === cat)
      .sort((a, b) => a.priority - b.priority),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="space-y-6">
      <CommandHeader
        badge="Strategy"
        badgeTone="warning"
        title="War Room"
        description="An AI strategist reads the full Archive — every idea, verdict, listing, and order — and proposes moves to grow the business. It recommends; you decide and execute."
        aside={
          <button
            type="button"
            onClick={runWarRoom}
            disabled={running}
            className="inline-flex items-center justify-center rounded-md border border-[var(--accent-orange)]/50 bg-[var(--accent-orange)]/15 px-4 py-2 text-sm font-semibold text-[var(--accent-orange)] hover:bg-[var(--accent-orange)]/25 disabled:opacity-60"
          >
            {running ? "Running…" : "Run War Room"}
          </button>
        }
        sysline="SYS.AJAX.WARROOM :: STRATEGY"
      />

      <ToastBanner toast={toast} />

      {grouped.length === 0 ? (
        <div className="factory-panel panel-glow-blue text-center">
          <p className="text-lg font-semibold">No recommendations yet</p>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Run the War Room to analyze your archive and generate strategy.
          </p>
        </div>
      ) : (
        grouped.map((group) => (
          <section key={group.cat} className="space-y-3">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--accent-blue)]">
              {CATEGORY_LABELS[group.cat]}
            </h2>
            <ul className="space-y-3">
              {group.items.map((rec) => (
                <li key={rec.id} className="factory-panel">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-black/30 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                        P{rec.priority}
                      </span>
                      <h3 className="text-base font-semibold">{rec.title}</h3>
                    </div>
                    <StatusBadge
                      label={rec.status}
                      tone={statusTone(rec.status)}
                    />
                  </div>

                  <p className="mt-2 text-sm text-[var(--foreground)]">
                    {rec.rationale}
                  </p>

                  {rec.recommendedAction ? (
                    <p className="mt-2 text-sm text-[var(--text-muted)]">
                      <span className="font-semibold text-[var(--foreground)]">
                        Action:{" "}
                      </span>
                      {rec.recommendedAction}
                    </p>
                  ) : null}

                  {rec.draftedIdeaId ? (
                    <p className="mt-2 text-xs text-[var(--accent-blue)]">
                      ✓ Draft idea queued for Nova
                    </p>
                  ) : null}

                  <div className="mt-3 flex flex-wrap gap-2">
                    {rec.status !== "accepted" ? (
                      <ActionButton
                        label="Accept"
                        onClick={() => setStatus(rec.id, "accepted")}
                        busy={actingId === rec.id}
                      />
                    ) : null}
                    {rec.status !== "actioned" ? (
                      <ActionButton
                        label="Mark actioned"
                        onClick={() => setStatus(rec.id, "actioned")}
                        busy={actingId === rec.id}
                      />
                    ) : null}
                    <ActionButton
                      label="Dismiss"
                      onClick={() => setStatus(rec.id, "dismissed")}
                      busy={actingId === rec.id}
                      subtle
                    />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <ButtonLink href="/factory" variant="secondary">
        Back to factory
      </ButtonLink>
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  busy,
  subtle,
}: {
  label: string;
  onClick: () => void;
  busy: boolean;
  subtle?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={
        subtle
          ? "inline-flex items-center rounded-md border border-[var(--border-dim)] px-3 py-1.5 text-xs font-semibold text-[var(--text-muted)] hover:bg-white/5 disabled:opacity-60"
          : "inline-flex items-center rounded-md border border-[var(--accent-blue)]/50 bg-[var(--accent-blue)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/20 disabled:opacity-60"
      }
    >
      {label}
    </button>
  );
}

function Callout({
  title,
  body,
  href,
  hrefLabel,
}: {
  title: string;
  body: string;
  href?: string;
  hrefLabel?: string;
}) {
  return (
    <div className="factory-panel panel-glow-orange max-w-xl">
      <h1 className="text-xl font-bold">{title}</h1>
      <p className="mt-2 text-sm text-[var(--text-muted)]">{body}</p>
      {href && hrefLabel ? (
        <a
          href={href}
          className="mt-4 inline-flex text-sm font-semibold text-[var(--accent-blue)] hover:underline"
        >
          {hrefLabel} →
        </a>
      ) : null}
    </div>
  );
}
