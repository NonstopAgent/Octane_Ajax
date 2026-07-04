"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CommandHeader } from "@/components/layout/command-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { ButtonLink } from "@/components/ui/button";
import {
  ToastBanner,
  type ToastState,
  type ToastTone,
} from "@/components/factory/toast-banner";
import type { Business } from "@/lib/businesses/types";

type Props = {
  initialBusinesses: Business[];
  activeBusinessId: string | null;
  isAuthenticated: boolean;
  configReady: boolean;
};

export function BusinessesDashboard({
  initialBusinesses,
  activeBusinessId,
  isAuthenticated,
  configReady,
}: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [niche, setNiche] = useState("");
  const [creating, setCreating] = useState(false);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);

  const activate = async (businessId: string) => {
    setActivatingId(businessId);
    try {
      const res = await fetch("/api/ajax/businesses/activate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        showToast("error", data.error ?? "Could not activate business.");
        return;
      }
      showToast("success", "Active business updated. New production routes here.");
      router.refresh();
    } catch {
      showToast("error", "Network error while activating.");
    } finally {
      setActivatingId(null);
    }
  };

  const showToast = (tone: ToastTone, message: string) => {
    setToast({ tone, message });
    window.setTimeout(() => setToast(null), 6000);
  };

  const create = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/ajax/businesses/create", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, niche }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        showToast("error", data.error ?? "Could not create business.");
        return;
      }
      showToast("success", `Registered ${name.trim()}.`);
      setName("");
      setNiche("");
      router.refresh();
    } catch {
      showToast("error", "Network error while creating business.");
    } finally {
      setCreating(false);
    }
  };

  if (!configReady) {
    return (
      <Callout
        title="Supabase not configured"
        body="Add Supabase env vars to manage businesses."
      />
    );
  }
  if (!isAuthenticated) {
    return (
      <Callout
        title="Sign in required"
        body="Sign in to manage your businesses."
        href="/login?next=/businesses"
        hrefLabel="Sign in"
      />
    );
  }

  return (
    <div className="space-y-6">
      <CommandHeader
        badge="Ecosystem"
        badgeTone="blue"
        title="Businesses"
        description="Every shop the ecosystem runs. The primary business is live; new businesses are registered here as the empire grows."
        sysline="SYS.AJAX.ECOSYSTEM :: BUSINESSES"
      />
      <ToastBanner toast={toast} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {initialBusinesses.map((b, i) => (
          <div
            key={b.id}
            className={"factory-panel " + (b.isPrimary ? "panel-glow-blue" : "")}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
                Business {String(i + 1).padStart(2, "0")}
              </span>
              {b.id === activeBusinessId ? (
                <StatusBadge label="active" tone="blue" />
              ) : (
                <StatusBadge
                  label={b.isPrimary ? "live" : b.status}
                  tone={b.isPrimary ? "blue" : "warning"}
                />
              )}
            </div>
            <h3 className="mt-2 text-lg font-bold">{b.name}</h3>
            {b.niche ? (
              <p className="mt-1 text-sm text-[var(--text-muted)]">{b.niche}</p>
            ) : null}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {b.id === activeBusinessId ? (
                <span className="inline-flex items-center rounded-md border border-[var(--accent-blue)]/40 bg-[var(--accent-blue)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--accent-blue)]">
                  ◉ Active · new production routes here
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => void activate(b.id)}
                  disabled={activatingId === b.id}
                  className="inline-flex items-center rounded-md border border-[var(--border-dim)] px-3 py-1.5 text-xs font-semibold text-[var(--foreground)] hover:bg-white/5 disabled:opacity-60"
                >
                  {activatingId === b.id ? "Activating…" : "Activate"}
                </button>
              )}
              {b.isPrimary ? (
                <ButtonLink href="/factory" variant="secondary">
                  Open floor →
                </ButtonLink>
              ) : null}
            </div>
          </div>
        ))}

        <div className="factory-panel panel-glow-orange">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--accent-orange)]">
            New business
          </span>
          <div className="mt-3 space-y-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Business name"
              className="w-full rounded-md border border-[var(--border-dim)] bg-black/30 px-3 py-2 text-sm focus:border-[var(--accent-blue)] focus:outline-none"
            />
            <input
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              placeholder="Niche (e.g. Plant lovers)"
              className="w-full rounded-md border border-[var(--border-dim)] bg-black/30 px-3 py-2 text-sm focus:border-[var(--accent-blue)] focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void create()}
              disabled={!name.trim() || creating}
              className="factory-control factory-control-primary w-full py-2 disabled:opacity-60"
            >
              {creating ? "Registering…" : "▶ Register business"}
            </button>
          </div>
        </div>
      </div>

      <p className="text-xs text-[var(--text-muted)]">
        Activate a business to route new production to it — every idea, listing,
        and review a cycle creates is tagged to the active business. The factory
        floor currently shows a combined operations view; fully isolated
        per-business floors are the next phase.
      </p>
    </div>
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
