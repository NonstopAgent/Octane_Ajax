import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reclaimStaleOrders } from "@/lib/ajax/pod/order-processor";
import { TABLES } from "@/lib/supabase/schema";

type Row = Record<string, unknown>;

/**
 * Minimal order_queue + factory_events mock. Select filters on status-in +
 * updated_at-lt; update applies the same claim conditions atomically, which
 * is exactly the behaviour the reclaim relies on.
 */
function makeSupabase(rows: Row[], events: Row[]) {
  function builder(table: string) {
    const filters: ((r: Row) => boolean)[] = [];
    let patch: Row | null = null;
    let limitN = Infinity;

    const b = {
      select() {
        return b;
      },
      insert(payload: Row) {
        events.push({ table, ...payload });
        return Promise.resolve({ data: null, error: null });
      },
      update(p: Row) {
        patch = p;
        return b;
      },
      eq(col: string, val: unknown) {
        filters.push((r) => r[col] === val);
        return b;
      },
      in(col: string, vals: unknown[]) {
        filters.push((r) => vals.includes(r[col]));
        return b;
      },
      lt(col: string, val: string) {
        filters.push((r) => String(r[col]) < val);
        return b;
      },
      order() {
        return b;
      },
      limit(n: number) {
        limitN = n;
        return b;
      },
      then(resolve: (v: { data: Row[]; error: null }) => unknown) {
        const matched = rows.filter((r) => filters.every((f) => f(r)));
        if (patch) {
          for (const r of matched) Object.assign(r, patch);
        }
        return Promise.resolve({
          data: matched.slice(0, limitN),
          error: null,
        }).then(resolve);
      },
    };
    return b;
  }

  return {
    from(table: string) {
      if (table !== TABLES.ORDER_QUEUE && table !== TABLES.EVENTS) {
        throw new Error(`unexpected table ${table}`);
      }
      return builder(table);
    },
  } as never;
}

function minutesAgo(min: number): string {
  return new Date(Date.now() - min * 60_000).toISOString();
}

describe("reclaimStaleOrders (H4 backstop)", () => {
  it("re-queues an order stuck in processing_artwork past the stale window", async () => {
    const rows: Row[] = [
      {
        id: "o-1",
        user_id: "u1",
        etsy_order_id: "111",
        status: "processing_artwork",
        updated_at: minutesAgo(45),
      },
    ];
    const events: Row[] = [];

    const result = await reclaimStaleOrders(makeSupabase(rows, events), "u1");

    assert.equal(result.reclaimed.length, 1);
    assert.equal(result.reclaimed[0]?.etsyOrderId, "111");
    assert.equal(rows[0]?.status, "pending_personalization");
    assert.equal(
      events.some((e) => e.event_type === "order_processing_reclaimed"),
      true,
    );
  });

  it("leaves fresh processing_artwork rows alone", async () => {
    const rows: Row[] = [
      {
        id: "o-2",
        user_id: "u1",
        etsy_order_id: "222",
        status: "processing_artwork",
        updated_at: minutesAgo(5),
      },
    ];

    const result = await reclaimStaleOrders(makeSupabase(rows, []), "u1");

    assert.equal(result.reclaimed.length, 0);
    assert.equal(rows[0]?.status, "processing_artwork");
  });

  it("reports (but never resets) other non-terminal orders older than 1h", async () => {
    const rows: Row[] = [
      {
        id: "o-3",
        user_id: "u1",
        etsy_order_id: "333",
        status: "fulfillment_ready",
        updated_at: minutesAgo(90),
      },
      {
        id: "o-4",
        user_id: "u1",
        etsy_order_id: "444",
        status: "pending_personalization",
        updated_at: minutesAgo(30),
      },
    ];

    const result = await reclaimStaleOrders(makeSupabase(rows, []), "u1");

    assert.equal(result.reclaimed.length, 0);
    assert.deepEqual(
      result.stalled.map((s) => s.etsyOrderId),
      ["333"],
    );
    // fulfillment_ready must never be blind-reset: the production submit may
    // already have gone out, and a re-run could double-bill Printify.
    assert.equal(rows[0]?.status, "fulfillment_ready");
  });
});
