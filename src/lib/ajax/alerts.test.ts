import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clearAlert,
  fetchActiveAlerts,
  raiseAlert,
  sweepStuckWork,
} from "@/lib/ajax/alerts";
import type { Supabase } from "@/lib/supabase/helpers";

type Call = {
  table: string;
  op: "select" | "insert" | "update";
  payload?: Record<string, unknown>;
  filters: string[];
};

type Options = {
  /** Rows an open-alert lookup returns. */
  openRows?: Record<string, unknown>[];
  /** Count returned by head:true count queries, per table. */
  counts?: Record<string, number>;
  /** Throw on every call, to prove alerting never breaks its caller. */
  explode?: boolean;
};

function makeSupabase(calls: Call[], options: Options = {}): Supabase {
  const from = (table: string) => {
    let op: Call["op"] = "select";
    let payload: Record<string, unknown> | undefined;
    let isCount = false;
    const filters: string[] = [];
    const b: Record<string, unknown> = {
      select(_cols?: string, opts?: { count?: string; head?: boolean }) {
        if (opts?.head) isCount = true;
        return b;
      },
      insert(p: Record<string, unknown>) {
        op = "insert";
        payload = p;
        return b;
      },
      update(p: Record<string, unknown>) {
        op = "update";
        payload = p;
        return b;
      },
      eq(c: string, v: unknown) {
        filters.push(`eq:${c}=${String(v)}`);
        return b;
      },
      in(c: string, v: unknown[]) {
        filters.push(`in:${c}=${v.join("|")}`);
        return b;
      },
      is(c: string, v: unknown) {
        filters.push(`is:${c}=${String(v)}`);
        return b;
      },
      lt(c: string, v: unknown) {
        filters.push(`lt:${c}=${String(v)}`);
        return b;
      },
      gte(c: string, v: unknown) {
        filters.push(`gte:${c}=${String(v)}`);
        return b;
      },
      order() {
        return b;
      },
      limit() {
        return b;
      },
      then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
        if (options.explode) {
          return Promise.reject(new Error("db down")).then(resolve, reject);
        }
        calls.push({ table, op, payload, filters: [...filters] });
        if (isCount) {
          return Promise.resolve({
            data: null,
            count: options.counts?.[table] ?? 0,
            error: null,
          }).then(resolve, reject);
        }
        return Promise.resolve({
          data: op === "select" ? (options.openRows ?? []) : [],
          error: null,
        }).then(resolve, reject);
      },
    };
    return b;
  };
  return { from } as unknown as Supabase;
}

describe("raiseAlert", () => {
  it("inserts a new alert when none is open", async () => {
    const calls: Call[] = [];
    await raiseAlert(makeSupabase(calls), "u1", {
      kind: "autopilot_errors",
      severity: "warning",
      title: "3 errors",
      detail: "listings: 429",
    });
    const insert = calls.find((c) => c.op === "insert");
    assert.equal(insert?.payload?.kind, "autopilot_errors");
    assert.equal(insert?.payload?.occurrences, 1);
    assert.equal(insert?.payload?.user_id, "u1");
  });

  it("dedupes to one row and counts occurrences", async () => {
    const calls: Call[] = [];
    await raiseAlert(
      makeSupabase(calls, { openRows: [{ id: "a1", occurrences: 7 }] }),
      "u1",
      { kind: "autopilot_errors", severity: "warning", title: "again" },
    );
    // 20 failed overnight passes must be ONE banner, not 20.
    assert.equal(calls.filter((c) => c.op === "insert").length, 0);
    const update = calls.find((c) => c.op === "update");
    assert.equal(update?.payload?.occurrences, 8);
    assert.ok(update?.filters.includes("eq:id=a1"));
  });

  it("only ever matches UNRESOLVED alerts when deduping", async () => {
    const calls: Call[] = [];
    await raiseAlert(makeSupabase(calls), "u1", {
      kind: "k",
      severity: "info",
      title: "t",
    });
    const lookup = calls.find((c) => c.op === "select");
    assert.ok(lookup?.filters.includes("is:resolved_at=null"));
  });

  it("never throws — the caller is already in a failure branch", async () => {
    await raiseAlert(makeSupabase([], { explode: true }), "u1", {
      kind: "k",
      severity: "critical",
      title: "t",
    });
    await clearAlert(makeSupabase([], { explode: true }), "u1", "k");
  });
});

describe("clearAlert", () => {
  it("resolves every open row of that kind", async () => {
    const calls: Call[] = [];
    await clearAlert(makeSupabase(calls), "u1", "autopilot_etsy_down");
    const update = calls.find((c) => c.op === "update");
    assert.ok(update?.payload?.resolved_at);
    assert.ok(update?.filters.includes("eq:kind=autopilot_etsy_down"));
    assert.ok(update?.filters.includes("is:resolved_at=null"));
  });
});

describe("sweepStuckWork", () => {
  it("raises on paid orders stuck past the reclaim window", async () => {
    const calls: Call[] = [];
    await sweepStuckWork(makeSupabase(calls, { counts: { order_queue: 2 } }), "u1");
    const inserts = calls.filter((c) => c.op === "insert");
    const kinds = inserts.map((c) => String(c.payload?.kind));
    assert.ok(kinds.includes("orders_stuck"));
    // A paid customer waiting is the most severe thing this system can report.
    const stuck = inserts.find((c) => c.payload?.kind === "orders_stuck");
    assert.equal(stuck?.payload?.severity, "critical");
  });

  it("clears each class when the count is zero", async () => {
    const calls: Call[] = [];
    await sweepStuckWork(makeSupabase(calls, { counts: {} }), "u1");
    assert.equal(calls.filter((c) => c.op === "insert").length, 0);
    const cleared = calls
      .filter((c) => c.op === "update" && c.payload?.resolved_at)
      .flatMap((c) => c.filters.filter((f) => f.startsWith("eq:kind=")));
    for (const kind of [
      "orders_stuck",
      "orders_failed",
      "video_jobs_failed",
      "generations_failed",
    ]) {
      assert.ok(cleared.includes(`eq:kind=${kind}`), `${kind} not cleared`);
    }
  });

  it("uses the generation_status column, not status", async () => {
    // product_generations has no `status` column; an `.eq("status", …)` here
    // silently returns nothing and the alert never fires.
    const calls: Call[] = [];
    await sweepStuckWork(
      makeSupabase(calls, { counts: { product_generations: 1 } }),
      "u1",
    );
    const gen = calls.find((c) => c.table === "product_generations");
    assert.ok(gen?.filters.some((f) => f === "eq:generation_status=failed"));
  });

  it("never throws", async () => {
    await sweepStuckWork(makeSupabase([], { explode: true }), "u1");
  });
});

describe("fetchActiveAlerts", () => {
  it("sorts critical before warning before info", async () => {
    const rows = [
      { id: "1", kind: "a", severity: "info", title: "i", detail: null, occurrences: 1, first_seen_at: "t", last_seen_at: "t" },
      { id: "2", kind: "b", severity: "critical", title: "c", detail: null, occurrences: 1, first_seen_at: "t", last_seen_at: "t" },
      { id: "3", kind: "c", severity: "warning", title: "w", detail: null, occurrences: 1, first_seen_at: "t", last_seen_at: "t" },
    ];
    const out = await fetchActiveAlerts(makeSupabase([], { openRows: rows }), "u1");
    assert.deepEqual(
      out.map((a) => a.severity),
      ["critical", "warning", "info"],
    );
  });

  it("returns an empty list rather than throwing into the dashboard", async () => {
    assert.deepEqual(
      await fetchActiveAlerts(makeSupabase([], { openRows: [] }), "u1"),
      [],
    );
  });
});
