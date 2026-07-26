import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  acquireAutopilotLease,
  AUTOPILOT_LEASE_MS,
} from "@/lib/ajax/autopilot/lease";
import type { Supabase } from "@/lib/supabase/helpers";

type Call = { op: string; payload?: Record<string, unknown>; filters: string[] };

type Options = {
  /** Rows the claim UPDATE resolves with. `[]` = someone else holds it. */
  claimRows?: { lock_key: string }[];
  /** Make the seed upsert or the claim fail, to exercise fail-open. */
  failOn?: "upsert" | "update";
};

function makeSupabase(calls: Call[], options: Options = {}): Supabase {
  const from = () => {
    let mode: "upsert" | "update" | null = null;
    const filters: string[] = [];
    let payload: Record<string, unknown> | undefined;
    const b: Record<string, unknown> = {
      upsert(p: Record<string, unknown>, opts?: Record<string, unknown>) {
        mode = "upsert";
        payload = { ...p, __opts: opts };
        return b;
      },
      update(p: Record<string, unknown>) {
        mode = "update";
        payload = p;
        return b;
      },
      select() {
        return b;
      },
      eq(col: string, val: unknown) {
        filters.push(`eq:${col}=${String(val)}`);
        return b;
      },
      lt(col: string, val: unknown) {
        filters.push(`lt:${col}=${String(val)}`);
        return b;
      },
      then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
        calls.push({ op: mode ?? "unknown", payload, filters: [...filters] });
        if (options.failOn === mode) {
          return Promise.resolve({
            data: null,
            error: { message: "relation does not exist" },
          }).then(resolve, reject);
        }
        if (mode === "update") {
          return Promise.resolve({
            data: options.claimRows ?? [{ lock_key: "shop_autopilot" }],
            error: null,
          }).then(resolve, reject);
        }
        return Promise.resolve({ data: null, error: null }).then(
          resolve,
          reject,
        );
      },
    };
    return b;
  };
  return { from } as unknown as Supabase;
}

describe("acquireAutopilotLease", () => {
  it("claims the lease with a single conditional UPDATE", async () => {
    const calls: Call[] = [];
    const lease = await acquireAutopilotLease(makeSupabase(calls), "u1");

    assert.equal(lease.acquired, true);
    assert.equal(lease.degraded, false);

    const claim = calls.find((c) => c.op === "update");
    assert.ok(claim, "no claim UPDATE issued");
    // The whole point of M3: the expiry check is IN the update, not a
    // preceding SELECT. A check-then-act guard lets two passes both start.
    assert.ok(
      claim.filters.some((f) => f.startsWith("lt:locked_until=")),
      `claim was not conditional on expiry: ${claim.filters.join(", ")}`,
    );
    assert.ok(claim.filters.includes("eq:user_id=u1"));
  });

  it("takes a lease longer than the 800s function budget it guards", async () => {
    const calls: Call[] = [];
    await acquireAutopilotLease(makeSupabase(calls), "u1");
    const claim = calls.find((c) => c.op === "update");
    const until = Date.parse(String(claim?.payload?.locked_until));
    // The old guard expired at 8 minutes while the pass could run 13+.
    assert.ok(until - Date.now() > 800_000, "lease shorter than maxDuration");
    assert.equal(AUTOPILOT_LEASE_MS, 15 * 60 * 1000);
  });

  it("stands down when another pass holds the lease", async () => {
    const calls: Call[] = [];
    const lease = await acquireAutopilotLease(
      makeSupabase(calls, { claimRows: [] }),
      "u1",
    );
    assert.equal(lease.acquired, false);
    assert.equal(lease.degraded, false);
  });

  it("releases only its own lease", async () => {
    const calls: Call[] = [];
    const lease = await acquireAutopilotLease(makeSupabase(calls), "u1", {
      holder: "pass-abc",
    });
    await lease.release();

    const release = calls.filter((c) => c.op === "update").at(-1);
    assert.ok(release);
    // Without the holder filter, a pass that overran its lease would release
    // the lease a DIFFERENT pass now holds — handing out a second green light.
    assert.ok(release.filters.includes("eq:holder=pass-abc"));
    const releasedUntil = Date.parse(String(release.payload?.locked_until));
    assert.ok(releasedUntil <= Date.now() + 1000, "release did not free slot");
  });

  it("fails OPEN when the lock table is unavailable", async () => {
    for (const failOn of ["upsert", "update"] as const) {
      const lease = await acquireAutopilotLease(
        makeSupabase([], { failOn }),
        "u1",
      );
      // A lock outage must not stop the shop loop — it degrades the guarantee,
      // it does not become an outage of its own.
      assert.equal(lease.acquired, true, `${failOn}: blocked the pass`);
      assert.equal(lease.degraded, true, `${failOn}: not reported as degraded`);
      assert.match(String(lease.reason), /relation does not exist/);
      await lease.release(); // must not throw
    }
  });

  it("release is safe to call on a lease that was never acquired", async () => {
    const lease = await acquireAutopilotLease(
      makeSupabase([], { claimRows: [] }),
      "u1",
    );
    await lease.release();
  });
});
