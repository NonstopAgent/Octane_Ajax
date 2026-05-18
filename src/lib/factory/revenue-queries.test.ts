import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getPipelineFunnel,
  getPublishedListingCount,
  getWeekStartIso,
  getWeeklyApprovedListingCount,
  getWeeklyGenerationCount,
} from "@/lib/factory/revenue-queries";
import { TABLES } from "@/lib/supabase/schema";

type QueryResult = {
  data: unknown;
  error: null;
  count?: number;
};

type QueryCall = { table: string; filters: string[] };

function createCountMockSupabase(
  resolveCount: (call: QueryCall) => number,
  userId: string,
) {
  const calls: QueryCall[] = [];

  const supabase = {
    from(table: string) {
      const record: QueryCall = { table, filters: [] };
      calls.push(record);

      const builder = {
        select: () => builder,
        eq: (column: string, value: string) => {
          record.filters.push(`${column}=${value}`);
          return builder;
        },
        in: (column: string, values: string[]) => {
          record.filters.push(`${column}=${values.join("|")}`);
          return builder;
        },
        gte: (column: string, value: string) => {
          record.filters.push(`${column}>=${value}`);
          return builder;
        },
        then(
          onFulfilled: (value: QueryResult) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) {
          return Promise.resolve({
            data: null,
            error: null,
            count: resolveCount(record),
          }).then(onFulfilled, onRejected);
        },
      };

      return builder;
    },
  };

  return { supabase: supabase as never, calls, userId };
}

describe("getWeekStartIso", () => {
  it("returns Monday 00:00 UTC for a mid-week date", () => {
    const weekStart = getWeekStartIso(new Date("2026-05-14T15:30:00.000Z"));
    assert.equal(weekStart, "2026-05-11T00:00:00.000Z");
  });

  it("rolls back to previous Monday when called on Sunday", () => {
    const weekStart = getWeekStartIso(new Date("2026-05-17T12:00:00.000Z"));
    assert.equal(weekStart, "2026-05-11T00:00:00.000Z");
  });
});

describe("getPublishedListingCount", () => {
  it("counts published listings for the user", async () => {
    const { supabase, calls, userId } = createCountMockSupabase(
      () => 7,
      "user-1",
    );

    const count = await getPublishedListingCount(supabase, userId);
    assert.equal(count, 7);

    const listingQuery = calls.find((c) => c.table === TABLES.LISTINGS);
    assert.ok(listingQuery);
    assert.ok(listingQuery.filters.includes(`user_id=${userId}`));
    assert.ok(listingQuery.filters.includes("status=published"));
  });
});

describe("getWeeklyGenerationCount", () => {
  it("filters generations by user and week start", async () => {
    const weekStart = "2026-05-11T00:00:00.000Z";
    const { supabase, calls, userId } = createCountMockSupabase(() => 4, "user-1");

    const count = await getWeeklyGenerationCount(supabase, userId, weekStart);
    assert.equal(count, 4);

    const query = calls.find((c) => c.table === TABLES.GENERATIONS);
    assert.ok(query);
    assert.ok(query.filters.includes(`user_id=${userId}`));
    assert.ok(query.filters.includes(`created_at>=${weekStart}`));
  });
});

describe("getWeeklyApprovedListingCount", () => {
  it("counts approved or published listings created this week", async () => {
    const weekStart = "2026-05-11T00:00:00.000Z";
    const { supabase, calls, userId } = createCountMockSupabase(() => 2, "user-1");

    const count = await getWeeklyApprovedListingCount(
      supabase,
      userId,
      weekStart,
    );
    assert.equal(count, 2);

    const query = calls.find((c) => c.table === TABLES.LISTINGS);
    assert.ok(query);
    assert.ok(query.filters.includes("status=approved|published"));
    assert.ok(query.filters.includes(`created_at>=${weekStart}`));
  });
});

describe("getPipelineFunnel", () => {
  it("returns ideas and passed for the week, approved and published all time", async () => {
    const weekStart = "2026-05-11T00:00:00.000Z";
    const { supabase, calls, userId } = createCountMockSupabase((call) => {
      if (call.table === TABLES.IDEAS) {
        return call.filters.some((f) => f.includes("brain_verdict")) ? 6 : 10;
      }
      if (call.table === TABLES.LISTINGS) {
        return call.filters.includes("status=published") ? 2 : 3;
      }
      return 0;
    }, "user-1");

    const funnel = await getPipelineFunnel(supabase, userId, weekStart);

    assert.deepEqual(funnel, {
      ideas: 10,
      passed: 6,
      approved: 3,
      published: 2,
    });

    const ideaQueries = calls.filter((c) => c.table === TABLES.IDEAS);
    assert.equal(ideaQueries.length, 2);
    assert.ok(
      ideaQueries.every((q) =>
        q.filters.some((f) => f === `created_at>=${weekStart}`),
      ),
    );
    assert.ok(
      ideaQueries[1]?.filters.some((f) =>
        f.includes("brain_verdict=approve_for_generation"),
      ),
    );

    const listingQueries = calls.filter((c) => c.table === TABLES.LISTINGS);
    assert.equal(listingQueries.length, 2);
    assert.ok(
      listingQueries[0]?.filters.some((f) => f === "status=approved|published"),
    );
    assert.ok(listingQueries[1]?.filters.includes("status=published"));
    assert.ok(
      listingQueries.every((q) =>
        q.filters.every((f) => !f.startsWith("created_at>=")),
      ),
    );
  });
});
