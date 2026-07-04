import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  refreshEtsyKeywordCounts,
  saveManualKeywords,
} from "@/lib/ajax/nova/keyword-ingest";
import type { Supabase } from "@/lib/supabase/helpers";

/** Minimal chainable Supabase mock that records inserts/updates. */
function makeSupabase(state: {
  existing?: { id: string; term: string }[];
  inserts: Record<string, unknown>[];
  updates: Record<string, unknown>[];
}) {
  const builder = () => {
    let mode: "select" | "insert" | "update" | "count" = "select";
    let rows: Record<string, unknown>[] = [];
    const b: Record<string, unknown> = {
      select(_cols?: string, opts?: { head?: boolean }) {
        if (opts?.head) mode = "count";
        else if (mode !== "insert") mode = "select";
        return b;
      },
      eq() {
        return b;
      },
      in() {
        return b;
      },
      update(patch: Record<string, unknown>) {
        mode = "update";
        state.updates.push(patch);
        return b;
      },
      insert(payload: Record<string, unknown>[]) {
        mode = "insert";
        rows = payload;
        state.inserts.push(...payload);
        return b;
      },
      then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
        let out: unknown;
        if (mode === "count") out = { count: state.existing?.length ?? 0, error: null };
        else if (mode === "update") out = { error: null };
        else if (mode === "insert")
          out = { data: rows.map((_, i) => ({ id: `new-${i}` })), error: null };
        else out = { data: state.existing ?? [], error: null };
        return Promise.resolve(out).then(resolve, reject);
      },
    };
    return b;
  };
  return { from: () => builder() } as unknown as Supabase;
}

describe("refreshEtsyKeywordCounts", () => {
  it("inserts new terms and updates existing ones with real counts", async () => {
    const state = {
      existing: [{ id: "x1", term: "gotcha day gift" }],
      inserts: [] as Record<string, unknown>[],
      updates: [] as Record<string, unknown>[],
    };
    const result = await refreshEtsyKeywordCounts({
      supabase: makeSupabase(state),
      userId: "u1",
      apiKey: "k",
      terms: ["gotcha day gift", "new puppy gift"],
      fetchCount: async (term) => (term === "gotcha day gift" ? 5000 : 1200),
    });

    assert.equal(result.upserted, 2);
    assert.equal(result.updated, 1);
    assert.equal(result.inserted, 1);
    // existing term → update carried a real competing_listings and etsy source
    assert.equal(state.updates[0]?.competing_listings, 5000);
    assert.equal(state.updates[0]?.source, "etsy_api");
    // update must NOT touch searches_per_month (preserves any manual demand)
    assert.ok(!("searches_per_month" in state.updates[0]!));
    // new term → insert with etsy source
    assert.equal(state.inserts[0]?.term, "new puppy gift");
    assert.equal(state.inserts[0]?.competing_listings, 1200);
    assert.equal(state.inserts[0]?.source, "etsy_api");
  });

  it("writes nothing when the API returns no counts", async () => {
    const state = { existing: [], inserts: [], updates: [] };
    const result = await refreshEtsyKeywordCounts({
      supabase: makeSupabase(state),
      userId: "u1",
      apiKey: "k",
      terms: ["dog dad gift"],
      fetchCount: async () => null,
    });
    assert.equal(result.upserted, 0);
    assert.equal(state.inserts.length, 0);
    assert.equal(state.updates.length, 0);
  });
});

describe("saveManualKeywords", () => {
  it("saves operator demand numbers as source 'manual'", async () => {
    const state = { existing: [], inserts: [], updates: [] };
    const result = await saveManualKeywords(makeSupabase(state), "u1", [
      { term: "personalized dog mom gift", searchesPerMonth: 1300, competingListings: 900 },
    ]);
    assert.equal(result.inserted, 1);
    assert.equal(state.inserts[0]?.searches_per_month, 1300);
    assert.equal(state.inserts[0]?.source, "manual");
  });

  it("a demand-only update does not clobber an existing competing count", async () => {
    const state = {
      existing: [{ id: "x2", term: "cat mom coffee mug" }],
      inserts: [] as Record<string, unknown>[],
      updates: [] as Record<string, unknown>[],
    };
    await saveManualKeywords(makeSupabase(state), "u1", [
      { term: "cat mom coffee mug", searchesPerMonth: 600 },
    ]);
    assert.equal(state.updates[0]?.searches_per_month, 600);
    // competing_listings must be absent from the patch (preserved)
    assert.ok(!("competing_listings" in state.updates[0]!));
  });
});
