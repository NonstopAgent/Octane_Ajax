import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { drainVideoJobs, enqueueVideoJob } from "@/lib/ajax/video/jobs";
import type { Supabase } from "@/lib/supabase/helpers";

type State = {
  jobs: Record<string, unknown>[];
  inserts: Record<string, unknown>[];
  updates: Record<string, unknown>[];
};

function makeSupabase(state: State): Supabase {
  const from = () => {
    let mode: "insert" | "update" | "select" | null = null;
    const b: Record<string, unknown> = {
      insert(p: Record<string, unknown>) {
        mode = "insert";
        state.inserts.push(p);
        return b;
      },
      update(p: Record<string, unknown>) {
        mode = "update";
        state.updates.push(p);
        return b;
      },
      select() {
        mode = "select";
        return b;
      },
      eq() {
        return b;
      },
      order() {
        return b;
      },
      limit() {
        return b;
      },
      then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
        const out =
          mode === "select"
            ? { data: state.jobs, error: null }
            : { data: null, error: null };
        return Promise.resolve(out).then(resolve, reject);
      },
    };
    return b;
  };
  return { from } as unknown as Supabase;
}

const completedPoll = async () => ({
  ok: true,
  status: "completed" as const,
  videoUrl: "https://fal.media/out.mp4",
  model: "m",
});

describe("enqueueVideoJob", () => {
  it("inserts a pending job row", async () => {
    const state: State = { jobs: [], inserts: [], updates: [] };
    const r = await enqueueVideoJob(makeSupabase(state), {
      userId: "u1",
      kind: "etsy_listing",
      requestId: "req-1",
      etsyListingId: "L1",
    });
    assert.equal(r.ok, true);
    assert.equal(state.inserts[0]?.status, "pending");
    assert.equal(state.inserts[0]?.request_id, "req-1");
  });
});

describe("drainVideoJobs", () => {
  it("attaches a completed etsy_listing render to the listing", async () => {
    const state: State = {
      jobs: [
        {
          id: "j1",
          kind: "etsy_listing",
          request_id: "req-1",
          etsy_listing_id: "L-etsy",
          post_text: null,
          platforms: null,
          attempts: 0,
        },
      ],
      inserts: [],
      updates: [],
    };
    let uploaded: { listingId: string; isBuffer: boolean } | null = null;
    const summary = await drainVideoJobs(makeSupabase(state), "u1", {
      poll: completedPoll,
      refreshTokenFn: (async () => ({
        shop_id: "S1",
        access_token: "T1",
      })) as never,
      createAdapter: (() => ({
        uploadListingVideo: async (listingId: string, buf: Buffer) => {
          uploaded = { listingId, isBuffer: Buffer.isBuffer(buf) };
          return { listing_video_id: "v1" };
        },
      })) as never,
      fetchImpl: (async () => ({
        ok: true,
        arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
      })) as unknown as typeof fetch,
    });
    assert.equal(summary.done, 1);
    assert.equal(uploaded!.listingId, "L-etsy");
    assert.equal(uploaded!.isBuffer, true);
    assert.ok(state.updates.some((u) => u.status === "done"));
  });

  it("completes a social render WITHOUT auto-publishing (poster owns posting)", async () => {
    // Regression guard: the drain used to fire every finished social render
    // straight to Ayrshare — uncapped, no events — producing ~25 posts in one
    // night on 2026-07-14. Posting is the capped auto-poster's job alone.
    const state: State = {
      jobs: [
        {
          id: "j2",
          kind: "social",
          request_id: "req-2",
          etsy_listing_id: null,
          post_text: "New pet drop",
          platforms: ["instagram"],
          attempts: 0,
        },
      ],
      inserts: [],
      updates: [],
    };
    let published = false;
    const summary = await drainVideoJobs(makeSupabase(state), "u1", {
      poll: completedPoll,
      publish: (async () => {
        published = true;
        return { ok: true };
      }) as never,
    });
    assert.equal(summary.done, 1);
    assert.equal(published, false, "drain must never publish to social");
    // The clip is stored as done with its URL so the poster can reuse it.
    const done = state.updates.find((u) => u.status === "done");
    assert.ok(done);
  });

  it("leaves a still-rendering job pending and bumps attempts", async () => {
    const state: State = {
      jobs: [
        {
          id: "j3",
          kind: "etsy_listing",
          request_id: "req-3",
          etsy_listing_id: "L3",
          post_text: null,
          platforms: null,
          attempts: 2,
        },
      ],
      inserts: [],
      updates: [],
    };
    const summary = await drainVideoJobs(makeSupabase(state), "u1", {
      poll: async () => ({ ok: true, status: "pending", model: "m" }),
    });
    assert.equal(summary.stillPending, 1);
    assert.equal(summary.done, 0);
    assert.equal(state.updates[0]?.attempts, 3);
  });
});
