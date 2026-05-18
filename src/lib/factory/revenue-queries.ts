import { mapAgentFromDb, mapEventFromDb } from "@/lib/ajax/mappers";
import type { AjaxAgent, FactoryEvent } from "@/lib/ajax/types";
import { PRODUCT_BRAIN_VERDICTS } from "@/lib/supabase/schema";
import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";

const APPROVE_VERDICT = PRODUCT_BRAIN_VERDICTS[0];

export type PipelineFunnel = {
  ideas: number;
  passed: number;
  approved: number;
  published: number;
};

/** UTC Monday 00:00:00 — start of the current calendar week. */
export function getWeekStartIso(now = new Date()): string {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const day = d.getUTCDay();
  const daysFromMonday = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - daysFromMonday);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function getPublishedListingCount(
  supabase: Supabase,
  userId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from(TABLES.LISTINGS)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "published");

  if (error) throw error;
  return count ?? 0;
}

export async function getWeeklyGenerationCount(
  supabase: Supabase,
  userId: string,
  weekStart = getWeekStartIso(),
): Promise<number> {
  const { count, error } = await supabase
    .from(TABLES.GENERATIONS)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", weekStart);

  if (error) throw error;
  return count ?? 0;
}

export async function getWeeklyApprovedListingCount(
  supabase: Supabase,
  userId: string,
  weekStart = getWeekStartIso(),
): Promise<number> {
  const { count, error } = await supabase
    .from(TABLES.LISTINGS)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("status", ["approved", "published"])
    .gte("created_at", weekStart);

  if (error) throw error;
  return count ?? 0;
}

export async function getPipelineFunnel(
  supabase: Supabase,
  userId: string,
  weekStart = getWeekStartIso(),
): Promise<PipelineFunnel> {
  const [ideasResult, passedResult, approvedResult, publishedResult] =
    await Promise.all([
      supabase
        .from(TABLES.IDEAS)
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("created_at", weekStart),
      supabase
        .from(TABLES.IDEAS)
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("brain_verdict", APPROVE_VERDICT)
        .gte("created_at", weekStart),
      supabase
        .from(TABLES.LISTINGS)
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .in("status", ["approved", "published"]),
      supabase
        .from(TABLES.LISTINGS)
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("status", "published"),
    ]);

  if (ideasResult.error) throw ideasResult.error;
  if (passedResult.error) throw passedResult.error;
  if (approvedResult.error) throw approvedResult.error;
  if (publishedResult.error) throw publishedResult.error;

  return {
    ideas: ideasResult.count ?? 0,
    passed: passedResult.count ?? 0,
    approved: approvedResult.count ?? 0,
    published: publishedResult.count ?? 0,
  };
}

export async function fetchDashboardAgents(
  supabase: Supabase,
): Promise<AjaxAgent[]> {
  const { data, error } = await supabase
    .from(TABLES.AGENTS)
    .select("*")
    .in("slug", ["nova", "forge", "pixel"])
    .order("slug");

  if (error) throw error;
  return (data ?? []).map(mapAgentFromDb);
}

export async function fetchRecentDashboardEvents(
  supabase: Supabase,
  userId: string,
  limit = 8,
): Promise<FactoryEvent[]> {
  const { data, error } = await supabase
    .from(TABLES.EVENTS)
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map(mapEventFromDb);
}
