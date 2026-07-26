/**
 * Autopilot overlap lease.
 *
 * WHY THIS EXISTS (2026-07-25 audit, M3). The previous guard read the last 8
 * minutes of the append-only `factory_events` table for an `autopilot_started`
 * row and stood down if it found one. Three problems:
 *
 *   1. **It expired before the pass it protected.** The route declares
 *      `maxDuration = 800` and the pass carries a 600s soft budget, so minutes
 *      8–13 of a long pass were completely unguarded. A Vercel cron retry
 *      landing in that window ran a second full pass — double Etsy/Printify
 *      calls (rate limits), double promos.
 *   2. **Check-then-act.** SELECT, then a network round trip, then INSERT.
 *      Two passes starting together both read "nothing running" and both went.
 *   3. **Never released.** A pass that finished in 90 seconds still blocked
 *      the next one for the remaining 6½ minutes.
 *
 * This replaces it with a real lease: one row per (user, key), claimed by a
 * single atomic `UPDATE … WHERE locked_until < now()`. Postgres serialises
 * concurrent UPDATEs on the same row and re-evaluates the WHERE against the
 * committed version, so exactly one caller can ever see a row count of 1.
 * Released in a `finally`, so a fast pass frees the slot immediately, and a
 * crashed pass frees it when the lease expires.
 *
 * FAIL-OPEN, DELIBERATELY. If the lock table is unreachable, we run the pass
 * anyway and report `degraded`. Overlap costs duplicate API calls; a lock
 * outage that silently stopped every pass would cost the whole shop loop —
 * exactly the "failure that reports as success" class this audit is closing.
 */
import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";

/** Must exceed the route's `maxDuration` (800s) plus headroom. */
export const AUTOPILOT_LEASE_MS = 15 * 60 * 1000;

/** Lease slot. One per concurrency domain; the hourly shop pass owns this one. */
export const AUTOPILOT_LOCK_KEY = "shop_autopilot";

export type AutopilotLease = {
  /** False only when another pass holds an unexpired lease. */
  acquired: boolean;
  /** True when the lock table itself failed — we ran unguarded. */
  degraded: boolean;
  /** Why the lease could not be verified (degraded runs only). */
  reason?: string;
  /** Idempotent; safe to call in a `finally` even when `acquired` is false. */
  release: () => Promise<void>;
};

const noop = async () => {};

/**
 * PostgREST errors are plain `{ message, code, details }` objects, not Error
 * instances — an `instanceof Error` check on them silently discards the only
 * useful part ("relation autopilot_locks does not exist") and reports a
 * generic string instead. This is the whole reason a degraded lease can tell
 * you WHY it degraded.
 */
function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const { message, code } = err as { message?: unknown; code?: unknown };
    if (typeof message === "string" && message) {
      return typeof code === "string" && code ? `${message} (${code})` : message;
    }
  }
  return "lock unavailable";
}

export async function acquireAutopilotLease(
  supabase: Supabase,
  userId: string,
  options: { key?: string; ttlMs?: number; holder?: string } = {},
): Promise<AutopilotLease> {
  const key = options.key ?? AUTOPILOT_LOCK_KEY;
  const ttlMs = options.ttlMs ?? AUTOPILOT_LEASE_MS;
  const holder = options.holder ?? `pass-${Date.now()}`;
  const nowIso = new Date().toISOString();
  const untilIso = new Date(Date.now() + ttlMs).toISOString();

  try {
    // Create the slot if this user has never run a pass. `locked_until` is
    // seeded in the past so the claim below — not this upsert — is what grants
    // the lease; `ignoreDuplicates` keeps a concurrent creator from resetting
    // a lease someone already holds.
    const { error: seedError } = await supabase
      .from(TABLES.AUTOPILOT_LOCKS)
      .upsert(
        {
          user_id: userId,
          lock_key: key,
          locked_until: new Date(0).toISOString(),
        },
        { onConflict: "user_id,lock_key", ignoreDuplicates: true },
      );
    if (seedError) throw seedError;

    // The claim. Single statement, so the WHERE is evaluated under the row
    // lock — no check-then-act window.
    const { data, error } = await supabase
      .from(TABLES.AUTOPILOT_LOCKS)
      .update({ locked_until: untilIso, locked_at: nowIso, holder })
      .eq("user_id", userId)
      .eq("lock_key", key)
      .lt("locked_until", nowIso)
      .select("lock_key");
    if (error) throw error;

    if ((data ?? []).length === 0) {
      return { acquired: false, degraded: false, release: noop };
    }

    return {
      acquired: true,
      degraded: false,
      release: async () => {
        try {
          // `holder` scoping matters: if this pass overran its lease and a
          // later pass claimed the slot, releasing here would hand a second
          // concurrent pass the green light.
          await supabase
            .from(TABLES.AUTOPILOT_LOCKS)
            .update({ locked_until: new Date().toISOString() })
            .eq("user_id", userId)
            .eq("lock_key", key)
            .eq("holder", holder);
        } catch {
          // Expired leases self-heal; never fail a completed pass on release.
        }
      },
    };
  } catch (err) {
    return {
      acquired: true,
      degraded: true,
      reason: describeError(err),
      release: noop,
    };
  }
}
