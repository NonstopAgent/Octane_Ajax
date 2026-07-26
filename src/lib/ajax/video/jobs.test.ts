import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
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
      or() {
        return b;
      },
      order() {
        return b;
      },
      limit() {
        return b;
      },
      then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
        // update-mode resolves with row stubs so the H13 claim (which does
        // .update().eq().or().select() and checks row count) succeeds.
        const out =
          mode === "select"
            ? { data: state.jobs, error: null }
            : { data: state.jobs.map((j) => ({ id: j.id })), error: null };
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
  // The quiet-window freeze (listing-freeze.ts) short-circuits the drain and
  // has a DATE-BASED default — lift it here so these tests exercise the
  // drain itself regardless of when they run.
  const originalFreeze = process.env.AUTOPILOT_LISTING_FREEZE_UNTIL;
  beforeEach(() => {
    process.env.AUTOPILOT_LISTING_FREEZE_UNTIL = "";
  });
  afterEach(() => {
    if (originalFreeze === undefined) {
      delete process.env.AUTOPILOT_LISTING_FREEZE_UNTIL;
    } else {
      process.env.AUTOPILOT_LISTING_FREEZE_UNTIL = originalFreeze;
    }
  });

  it("skips the whole drain while listing writes are frozen (quiet window)", async () => {
    process.env.AUTOPILOT_LISTING_FREEZE_UNTIL = new Date(
      Date.now() + 60 * 60 * 1000,
    ).toISOString();
    const state: State = {
      jobs: [
        {
          id: "j-frozen",
          kind: "etsy_listing",
          request_id: "req-frozen",
          etsy_listing_id: "L-etsy",
          post_text: null,
          platforms: null,
          attempts: 0,
        },
      ],
      inserts: [],
      updates: [],
    };
    let polled = 0;
    const summary = await drainVideoJobs(makeSupabase(state), "u1", {
      poll: (async () => {
        polled += 1;
        return completedPoll();
      }) as never,
    });
    assert.equal(summary.processed, 0);
    assert.equal(polled, 0, "frozen drain must not poll fal at all");
    // Attempts untouched — the backlog drains normally after the freeze lifts.
    assert.equal(state.updates.length, 0);
  });

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
    const bump = state.updates.find((u) => "attempts" in u);
    assert.equal(bump?.attempts, 3);
  });
});

describe("drainVideoJobs — atomic claim (H13)", () => {
  const originalFreeze = process.env.AUTOPILOT_LISTING_FREEZE_UNTIL;
  beforeEach(() => {
    process.env.AUTOPILOT_LISTING_FREEZE_UNTIL = "";
  });
  afterEach(() => {
    if (originalFreeze === undefined) {
      delete process.env.AUTOPILOT_LISTING_FREEZE_UNTIL;
    } else {
      process.env.AUTOPILOT_LISTING_FREEZE_UNTIL = originalFreeze;
    }
  });

  it("skips a job another driver already claimed — never polls or marks it", async () => {
    // Supabase mock where the claim UPDATE matches ZERO rows (fresh claim by
    // a competing driver), while the pending SELECT still returns the job.
    const marks: unknown[] = [];
    const supabase = {
      from() {
        let mode: "select" | "update" = "select";
        const b: Record<string, unknown> = {
          select() {
            return b;
          },
          update(patch: Record<string, unknown>) {
            mode = "update";
            marks.push(patch);
            return b;
          },
          eq() {
            return b;
          },
          or() {
            return b;
          },
          order() {
            return b;
          },
          limit() {
            return b;
          },
          then(resolve: (v: unknown) => void) {
            const out =
              mode === "select"
                ? {
                    data: [
                      {
                        id: "contested",
                        kind: "etsy_listing",
                        request_id: "req-x",
                        etsy_listing_id: "L1",
                        post_text: null,
                        platforms: null,
                        attempts: 0,
                      },
                    ],
                    error: null,
                  }
                : { data: [], error: null }; // claim misses
            return Promise.resolve(out).then(resolve);
          },
        };
        return b;
      },
    } as never;

    let polled = 0;
    const summary = await drainVideoJobs(supabase, "u1", {
      poll: (async () => {
        polled += 1;
        return { ok: true, status: "completed" as const, videoUrl: "u", model: "m" };
      }) as never,
    });

    assert.equal(polled, 0, "a lost claim must never reach fal");
    assert.equal(summary.processed, 0);
    assert.equal(summary.done, 0);
    // The only write attempted was the claim itself — no status marks.
    assert.equal(
      marks.filter((m) => (m as Record<string, unknown>).status).length,
      0,
    );
  });
});
