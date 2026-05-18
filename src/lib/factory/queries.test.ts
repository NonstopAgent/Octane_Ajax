import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchFactorySnapshot } from "@/lib/factory/queries";
import { TABLES } from "@/lib/supabase/schema";

type QueryResult = {
  data: unknown;
  error: null;
  count?: number;
};

function createMockSupabase(userId: string) {
  const calls: { table: string; filters: string[] }[] = [];

  const tableResults: Record<string, QueryResult> = {
    [TABLES.AGENTS]: {
      data: [
        {
          id: "agent-1",
          slug: "nova",
          display_name: "Nova",
          status: "idle",
          current_room: "research_lab",
          current_task_id: null,
          last_heartbeat: new Date().toISOString(),
        },
      ],
      error: null,
    },
    [TABLES.EVENTS]: { data: [], error: null },
    [TABLES.IDEAS]: { data: [], error: null, count: 5 },
    [TABLES.REVIEW_QUEUE]: { data: [], error: null, count: 1 },
    [TABLES.CONTENT_JOBS]: { data: [], error: null, count: 2 },
    [TABLES.LISTINGS]: { data: [], error: null, count: 3 },
    [TABLES.TASKS]: { data: [], error: null },
  };

  const supabase = {
    from(table: string) {
      const record = { table, filters: [] as string[] };
      calls.push(record);
      const base = tableResults[table] ?? { data: [], error: null, count: 0 };

      const builder = {
        select: () => builder,
        eq: (column: string, value: string) => {
          record.filters.push(`${column}=${value}`);
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        in: () => builder,
        then(
          onFulfilled: (value: QueryResult) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) {
          return Promise.resolve(base).then(onFulfilled, onRejected);
        },
      };

      return builder;
    },
  };

  return { supabase: supabase as never, calls, userId };
}

describe("fetchFactorySnapshot store metrics", () => {
  it("counts published listings for storefront metrics", async () => {
    const { supabase, calls, userId } = createMockSupabase("user-1");
    const snapshot = await fetchFactorySnapshot(supabase, userId);

    assert.equal(snapshot.metrics.publishedListings, 3);
    assert.equal(snapshot.metrics.pendingReviews, 1);
    assert.equal(snapshot.metrics.scheduledContent, 2);
    assert.equal(snapshot.metrics.productIdeas, 5);

    const listingQuery = calls.find((c) => c.table === TABLES.LISTINGS);
    assert.ok(listingQuery);
    assert.ok(listingQuery.filters.some((f) => f === "status=published"));
    assert.ok(listingQuery.filters.some((f) => f === `user_id=${userId}`));
  });
});
