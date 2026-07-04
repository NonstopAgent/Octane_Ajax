"use client";

import { useMemo, useState } from "react";
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
  evidence?: unknown;
  status: RecStatus;
  draftedIdeaId: string | null;
  createdAt: string;
};

type Signals = {
  marketOpportunities: {
    term: string;
    searchesPerMonth: number | null;
    competingListings: number | null;
  }[];
  shopHealth: {
    overallScore: number;
    listingCount: number;
    critical: number;
    warning: number;
    topFixes: string[];
  };
} | null;

type WarRoomDashboardProps = {
  initialRecommendations: Recommendation[];
  signals?: Signals;
  isAuthenticated: boolean;
  configReady: boolean;
};

function healthColor(score: number): string {
  if (score >= 80) return "#34d399";
  if (score >= 60) return "var(--accent-orange)";
  return "#f87171";
}

const CATEGORY_META: Record<
  RecCategory,
  { label: string; accent: string; tag: string }
> = {
  niche: { label: "Niche & product strategy", accent: "var(--accent-blue)", tag: "Niche" },
  channel: { label: "Channel expansion", accent: "var(--accent-blue)", tag: "Channel" },
  pricing: { label: "Pricing & margins", accent: "#34d399", tag: "Pricing" },
  cut: { label: "Cut underperformers", accent: "var(--accent-orange)", tag: "Cut" },
  other: { label: "Other moves", accent: "var(--text-muted)", tag: "Other" },
};

const CATEGORY_ORDER: RecCategory[] = ["niche", "channel", "pricing", "cut", "other"];

function statusTone(
  status: RecStatus,
): "blue" | "orange" | "warning" | "neutral" {
  if (status === "accepted" || status === "actioned") return "blue";
  if (status === "dismissed") return "neutral";
  return "warning";
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const s = Math.floor((Date.now() - then) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function evidenceList(evidence: unknown): string[] {
  if (!evidence) return [];
  if (Array.isArray(evidence)) {
    return evidence.map((e) => String(e).trim()).filter(Boolean).slice(0, 4);
  }
  if (typeof evidence === "string") {
    return evidence.trim() ? [evidence.trim()] : [];
  }
  if (typeof evidence === "object") {
    return Object.entries(evidence as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${String(v)}`)
      .slice(0, 4);
  }
  return [String(evidence)];
}

function priorityColor(priority: number): string {
  if (priority <= 1) return "var(--accent-orange)";
  if (priority <= 3) return "var(--accent-blue)";
  return "var(--text-muted)";
}

export function WarRoomDashboard({
  initialRecommendations,
  signals,
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

  const stats = useMemo(() => {
    const active = initialRecommendations.filter((r) => r.status !== "dismissed");
    const lastRunIso = initialRecommendations.reduce<string | null>(
      (latest, r) =>
        !latest || new Date(r.createdAt) > new Date(latest) ? r.createdAt : latest,
      null,
    );
    return {
      active: active.length,
      proposed: active.filter((r) => r.status === "proposed").length,
      committed: active.filter(
        (r) => r.status === "accepted" || r.status === "actioned",
      ).length,
      draftedIdeas: active.filter((r) => r.draftedIdeaId).length,
      lastRun: lastRunIso ? timeAgo(lastRunIso) : "never",
    };
  }, [initialRecommendations]);

  const runButton = (
    <button
      type="button"
      onClick={runWarRoom}
      disabled={running}
      className="factory-control factory-control-primary px-4 py-2"
    >
      {running ? "Analyzing archive…" : "Run War Room"}
    </button>
  );

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
        description="An AI strategist reads the full Archive — ideas, verdicts, listings, orders, live Etsy metrics — PLUS real market demand and your shop-health, then proposes revenue-ranked moves. It recommends; you decide and execute."
        aside={runButton}
        sysline="SYS.AJAX.WARROOM :: STRATEGY"
      />

      <ToastBanner toast={toast} />

      {signals ? (
        <section className="grid gap-4 lg:grid-cols-2">
          <div className="factory-panel">
            <div className="flex items-center justify-between">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
                Shop health
              </h2>
              <a
                href="/store-qa"
                className="text-xs text-[var(--accent-blue)] hover:underline"
              >
                Open Store QA →
              </a>
            </div>
            <div className="mt-2 flex items-end gap-3">
              <span
                className="font-mono text-4xl font-bold tabular-nums"
                style={{ color: healthColor(signals.shopHealth.overallScore) }}
              >
                {signals.shopHealth.overallScore}
                <span className="text-base text-[var(--text-muted)]">/100</span>
              </span>
              <span className="pb-1 text-xs text-[var(--text-muted)]">
                {signals.shopHealth.listingCount} listings ·{" "}
                {signals.shopHealth.critical} critical ·{" "}
                {signals.shopHealth.warning} warnings
              </span>
            </div>
            {signals.shopHealth.topFixes.length > 0 ? (
              <ul className="mt-3 space-y-1 text-xs text-[var(--text-muted)]">
                {signals.shopHealth.topFixes.slice(0, 3).map((f, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-[var(--accent-orange)]" />
                    {f}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-xs text-emerald-300">
                Storefront looks clean.
              </p>
            )}
          </div>

          <div className="factory-panel">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
              Live market opportunity
            </h2>
            {signals.marketOpportunities.length > 0 ? (
              <ul className="mt-2 space-y-1.5">
                {signals.marketOpportunities.slice(0, 6).map((o) => (
                  <li
                    key={o.term}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <span className="min-w-0 truncate text-[var(--foreground)]">
                      {o.term}
                    </span>
                    <span className="shrink-0 font-mono text-[var(--text-muted)]">
                      {o.searchesPerMonth != null
                        ? `${o.searchesPerMonth}/mo`
                        : "—"}
                      {" · "}
                      {o.competingListings != null
                        ? `${o.competingListings} comp`
                        : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-[var(--text-muted)]">
                No demand data yet — connect Etsy and run a cycle to populate
                real search terms.
              </p>
            )}
          </div>
        </section>
      ) : null}

      {running && (
        <div className="factory-panel panel-glow-orange flex items-center gap-3">
          <span className="vis-spinner" style={{ color: "var(--accent-orange)" }} />
          <p className="text-sm text-[var(--text-muted)]">
            Reading the archive and ranking moves by revenue impact… this can take
            up to a minute.
          </p>
        </div>
      )}

      {grouped.length > 0 && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Active moves" value={stats.active} />
          <StatTile
            label="Awaiting your call"
            value={stats.proposed}
            accent="var(--accent-orange)"
          />
          <StatTile label="Committed" value={stats.committed} />
          <StatTile
            label="Ideas queued for Nova"
            value={stats.draftedIdeas}
            hint={`Last run ${stats.lastRun}`}
          />
        </section>
      )}

      {grouped.length === 0 ? (
        <div className="factory-panel panel-glow-blue text-center py-10">
          <p className="text-lg font-semibold">No strategy on the board yet</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--text-muted)]">
            Run the War Room and the strategist will read every idea, verdict,
            listing, order, and live Etsy metric, then hand you 4–8 ranked moves:
            niches to double down on, listings to fix, prices to adjust, and dead
            weight to cut.
          </p>
          <div className="mt-6 flex justify-center">{runButton}</div>
        </div>
      ) : (
        grouped.map((group) => (
          <section key={group.cat} className="space-y-3">
            <div className="flex items-center gap-3">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: CATEGORY_META[group.cat].accent }}
              />
              <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
                {CATEGORY_META[group.cat].label}
              </h2>
              <span className="font-mono text-[11px] text-[var(--text-muted)]/60">
                {group.items.length}
              </span>
              <span className="h-px flex-1 bg-[var(--border-dim)]" />
            </div>
            <ul className="space-y-3">
              {group.items.map((rec) => (
                <RecCard
                  key={rec.id}
                  rec={rec}
                  busy={actingId === rec.id}
                  onStatus={setStatus}
                />
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

function StatTile({
  label,
  value,
  accent = "var(--accent-blue)",
  hint,
}: {
  label: string;
  value: number;
  accent?: string;
  hint?: string;
}) {
  return (
    <div className="factory-metric command-metric" style={{ borderLeftColor: accent }}>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
        {label}
      </p>
      <p
        className="mt-1 font-mono text-3xl font-bold tabular-nums"
        style={{ color: accent }}
      >
        {value}
      </p>
      {hint ? (
        <p className="mt-0.5 text-[10px] text-[var(--text-muted)]/70">{hint}</p>
      ) : null}
    </div>
  );
}

function RecCard({
  rec,
  busy,
  onStatus,
}: {
  rec: Recommendation;
  busy: boolean;
  onStatus: (id: string, status: RecStatus) => void;
}) {
  const evidence = evidenceList(rec.evidence);
  const pct =
    rec.confidence != null
      ? Math.max(0, Math.min(100, Math.round(rec.confidence * 100)))
      : null;
  const pColor = priorityColor(rec.priority);

  return (
    <li className="factory-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="rounded px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide"
            style={{
              color: pColor,
              background: "rgba(0,0,0,0.35)",
              border: `1px solid ${pColor}`,
            }}
            title={`Priority ${rec.priority} of 5`}
          >
            P{rec.priority}
          </span>
          <span
            className="rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide"
            style={{ color: CATEGORY_META[rec.category].accent, background: "rgba(0,0,0,0.25)" }}
          >
            {CATEGORY_META[rec.category].tag}
          </span>
          <h3 className="min-w-0 text-base font-semibold">{rec.title}</h3>
        </div>
        <StatusBadge label={rec.status} tone={statusTone(rec.status)} />
      </div>

      {pct != null && (
        <div className="mt-3 flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
            Confidence
          </span>
          <div className="h-1.5 w-28 overflow-hidden rounded-full bg-white/8">
            <div
              className="h-full rounded-full"
              style={{ width: `${pct}%`, background: pColor }}
            />
          </div>
          <span className="font-mono text-[10px] tabular-nums text-[var(--text-muted)]">
            {pct}%
          </span>
        </div>
      )}

      <p className="mt-2 text-sm text-[var(--foreground)]">{rec.rationale}</p>

      {rec.recommendedAction ? (
        <div className="mt-3 rounded-md border-l-2 border-[var(--accent-blue)]/60 bg-black/25 px-3 py-2">
          <p className="text-sm text-[var(--foreground)]">
            <span className="font-semibold text-[var(--accent-blue)]">
              Next move:{" "}
            </span>
            {rec.recommendedAction}
          </p>
        </div>
      ) : null}

      {evidence.length > 0 && (
        <ul className="mt-3 space-y-1">
          {evidence.map((e, i) => (
            <li
              key={i}
              className="flex gap-2 text-xs text-[var(--text-muted)]"
            >
              <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-[var(--accent-blue)]" />
              <span>{e}</span>
            </li>
          ))}
        </ul>
      )}

      {rec.draftedIdeaId ? (
        <p className="mt-3 inline-flex items-center gap-1 rounded-full border border-[var(--accent-blue)]/40 bg-[var(--accent-blue)]/10 px-2.5 py-0.5 text-xs text-[var(--accent-blue)]">
          ✓ Draft idea queued for Nova
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {rec.status !== "accepted" ? (
          <ActionButton
            label="Accept"
            onClick={() => onStatus(rec.id, "accepted")}
            busy={busy}
          />
        ) : null}
        {rec.status !== "actioned" ? (
          <ActionButton
            label="Mark actioned"
            onClick={() => onStatus(rec.id, "actioned")}
            busy={busy}
          />
        ) : null}
        <ActionButton
          label="Dismiss"
          onClick={() => onStatus(rec.id, "dismissed")}
          busy={busy}
          subtle
        />
      </div>
    </li>
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
