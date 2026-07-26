/**
 * The failure surface.
 *
 * WHY (2026-07-25 audit, M10). `grep -rn "sendEmail\|slack\|notifyOperator\|
 * Sentry\|alert(" src` returned zero results: nothing in this system told the
 * operator when a 3am cron failed. The only records were a `factory_events`
 * row nobody reads and a Vercel log that ages out — and several failures were
 * actively reported as success ("shop is healthy" on a dead Etsy connection,
 * "published" on a Printify product left locked).
 *
 * This is deliberately the smallest thing that fixes it: one table, one
 * writer, one banner. No email/Slack dependency to configure and no new
 * secret — the operator opens Mission Control daily, so that's where a broken
 * loop has to be impossible to miss.
 *
 * Alerts are deduped by `kind` while unresolved: the hourly pass failing 20
 * times overnight is ONE alert with `occurrences: 20`, not 20 banners.
 */
import type { Json } from "@/lib/supabase/database.types";
import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";

export type AlertSeverity = "info" | "warning" | "critical";

export type AlertInput = {
  /** Dedupe key. Stable per failure class, e.g. "autopilot_etsy_down". */
  kind: string;
  severity: AlertSeverity;
  title: string;
  detail?: string;
  context?: Record<string, unknown>;
};

export type SystemAlert = {
  id: string;
  kind: string;
  severity: AlertSeverity;
  title: string;
  detail: string | null;
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
};

/**
 * Record a failure. Never throws — an alerting path that can break the caller
 * is worse than no alerting, and every call site is already in a failure
 * branch.
 */
export async function raiseAlert(
  supabase: Supabase,
  userId: string,
  input: AlertInput,
): Promise<void> {
  const nowIso = new Date().toISOString();
  try {
    const { data: open } = await supabase
      .from(TABLES.SYSTEM_ALERTS)
      .select("id, occurrences")
      .eq("user_id", userId)
      .eq("kind", input.kind)
      .is("resolved_at", null)
      .order("last_seen_at", { ascending: false })
      .limit(1);

    const existing = (open ?? [])[0];
    if (existing) {
      // Read-then-write: two passes failing in the same instant can produce a
      // duplicate row. Harmless — the banner groups by kind — and cheaper than
      // a DB function for a table only cron jobs write to.
      await supabase
        .from(TABLES.SYSTEM_ALERTS)
        .update({
          severity: input.severity,
          title: input.title,
          detail: input.detail ?? null,
          context: (input.context ?? {}) as Json,
          occurrences: (existing.occurrences ?? 1) + 1,
          last_seen_at: nowIso,
        })
        .eq("id", existing.id);
      return;
    }

    await supabase.from(TABLES.SYSTEM_ALERTS).insert({
      user_id: userId,
      kind: input.kind,
      severity: input.severity,
      title: input.title,
      detail: input.detail ?? null,
      context: (input.context ?? {}) as Json,
      occurrences: 1,
      first_seen_at: nowIso,
      last_seen_at: nowIso,
    });
  } catch {
    // Best-effort by design.
  }
}

/**
 * Close an alert class once the thing works again. Call this on the SUCCESS
 * path — an alert surface that only ever grows gets ignored, which is the same
 * outcome as not having one.
 */
export async function clearAlert(
  supabase: Supabase,
  userId: string,
  kind: string,
): Promise<void> {
  try {
    await supabase
      .from(TABLES.SYSTEM_ALERTS)
      .update({ resolved_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("kind", kind)
      .is("resolved_at", null);
  } catch {
    // Best-effort by design.
  }
}

/**
 * Hourly sweep for work that is stuck rather than failing loudly.
 *
 * These three checks are what turn the alert table into the single surface the
 * audit asked for: they catch H4 (personalized orders dying in
 * `processing_artwork` with no reclaim), H14 (a paid fal render discarded by a
 * transient error), and failed generations — none of which raise an error in
 * the pass that happens to be running when they go wrong.
 *
 * Deliberately count-only queries (`head: true`): this runs every hour inside
 * the autopilot's time budget.
 */
export async function sweepStuckWork(
  supabase: Supabase,
  userId: string,
): Promise<void> {
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const check = async (
    kind: string,
    severity: AlertSeverity,
    title: (n: number) => string,
    detail: string,
    query: PromiseLike<{ count: number | null; error: unknown }>,
  ) => {
    try {
      const { count, error } = await query;
      if (error) return;
      const n = count ?? 0;
      if (n > 0) {
        await raiseAlert(supabase, userId, {
          kind,
          severity,
          title: title(n),
          detail,
          context: { count: n },
        });
      } else {
        await clearAlert(supabase, userId, kind);
      }
    } catch {
      // Best-effort by design.
    }
  };

  await check(
    "orders_stuck",
    "critical",
    (n) => `${n} paid order(s) stuck in personalization for over an hour`,
    "A buyer has paid and nothing is moving. Open the Personalization Bay: these sit in pending_personalization or processing_artwork and will not self-heal past the reclaim window.",
    supabase
      .from(TABLES.ORDER_QUEUE)
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("status", ["pending_personalization", "processing_artwork"])
      .lt("updated_at", hourAgo),
  );

  await check(
    "orders_failed",
    "critical",
    (n) => `${n} paid order(s) failed fulfillment`,
    "These have status 'failed' in the order queue — a paid customer is waiting on a manual fix.",
    supabase
      .from(TABLES.ORDER_QUEUE)
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "failed"),
  );

  await check(
    "video_jobs_failed",
    "warning",
    (n) => `${n} video render(s) failed in the last 24h`,
    "Paid fal renders that ended in 'failed'. Check the last_error on video_jobs — repeated failures usually mean an expired asset URL or an exhausted daily cap.",
    supabase
      .from(TABLES.VIDEO_JOBS)
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "failed")
      .gte("created_at", dayAgo),
  );

  await check(
    "generations_failed",
    "warning",
    (n) => `${n} product generation(s) failed in the last 24h`,
    "Artwork or Printify product creation failed for these. Each one is a paid image generation that produced nothing sellable.",
    supabase
      .from(TABLES.GENERATIONS)
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("generation_status", "failed")
      .gte("created_at", dayAgo),
  );
}

/** Unresolved alerts, worst first, for the Mission Control banner. */
export async function fetchActiveAlerts(
  supabase: Supabase,
  userId: string,
  limit = 8,
): Promise<SystemAlert[]> {
  const { data, error } = await supabase
    .from(TABLES.SYSTEM_ALERTS)
    .select(
      "id, kind, severity, title, detail, occurrences, first_seen_at, last_seen_at",
    )
    .eq("user_id", userId)
    .is("resolved_at", null)
    .order("last_seen_at", { ascending: false })
    .limit(limit);
  if (error) return [];

  const rank: Record<string, number> = { critical: 0, warning: 1, info: 2 };
  return (data ?? [])
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      severity: (row.severity ?? "warning") as AlertSeverity,
      title: row.title,
      detail: row.detail,
      occurrences: row.occurrences ?? 1,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
    }))
    .sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9));
}
