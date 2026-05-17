"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { AgentMemoryCard } from "@/components/agents/agent-memory-card";
import type { AgentMemoryProfile } from "@/lib/ajax/agent-memory";
import { CommandHeader } from "@/components/layout/command-header";
import { Button, ButtonLink } from "@/components/ui/button";

type AgentsDashboardProps = {
  initialAgents: AgentMemoryProfile[];
  isAuthenticated: boolean;
  configReady: boolean;
};

export function AgentsDashboard({
  initialAgents,
  isAuthenticated,
  configReady,
}: AgentsDashboardProps) {
  const [agents, setAgents] = useState(initialAgents);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ajax/agent-memory", {
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Failed to load memory.");
        return;
      }
      setAgents(data.agents);
    } catch {
      setError("Network error while loading agent memory.");
    } finally {
      setLoading(false);
    }
  }, []);

  if (!configReady) {
    return (
      <Callout title="Supabase not configured" body="Add Supabase env vars to use agent memory." />
    );
  }

  if (!isAuthenticated) {
    return (
      <Callout
        title="Sign in required"
        body="Sign in to view agent memory from your approvals and rejections."
        href="/login?next=/agents"
      />
    );
  }

  return (
    <div className="space-y-6">
      <CommandHeader
        badge="Agent memory v1"
        title="Unit memory banks"
        description="Human feedback becomes deterministic learning notes — ready to inject into LLM prompts later. No vector DB yet."
        aside={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" disabled={loading} onClick={() => void refresh()}>
              {loading ? "Refreshing…" : "Refresh memory"}
            </Button>
            <ButtonLink href="/factory" variant="secondary">
              Factory floor
            </ButtonLink>
          </div>
        }
        sysline="SYS.AJAX.MEM :: DETERMINISTIC"
      />

      {error && (
        <p className="rounded border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {agents.map((profile) => (
          <AgentMemoryCard key={profile.slug} profile={profile} />
        ))}
      </div>
    </div>
  );
}

function Callout({
  title,
  body,
  href,
}: {
  title: string;
  body: string;
  href?: string;
}) {
  return (
    <div className="factory-panel panel-glow-blue max-w-xl">
      <h1 className="text-xl font-bold">{title}</h1>
      <p className="mt-2 text-sm text-[var(--text-muted)]">{body}</p>
      {href && (
        <Link
          href={href}
          className="mt-4 inline-flex text-sm font-semibold text-[var(--accent-blue)] hover:underline"
        >
          Settings →
        </Link>
      )}
    </div>
  );
}
