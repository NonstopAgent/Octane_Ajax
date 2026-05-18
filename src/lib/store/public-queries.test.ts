import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchPublicStoreListings } from "@/lib/store/public-queries";
import { TABLES } from "@/lib/supabase/schema";

type QueryResult = {
  data: unknown;
  error: null;
};

function createMockSupabase() {
  const calls: { table: string; filters: string[] }[] = [];

  const listingRow = {
    id: "listing-pub-1",
    title: "Weekly Planner",
    description: "Printable weekly goals.",
    price: 12,
    gumroad_url: "https://shop.gumroad.com/l/planner",
    status: "published",
    created_at: new Date().toISOString(),
    product_ideas: {
      id: "idea-1",
      user_id: "user-1",
      source: "nova",
      niche: "planners",
      title: "Weekly Planner",
      description: null,
      seo_keywords: ["planner", "goals"],
      trend_score: 70,
      status: "selected",
      raw_payload: {},
      created_at: new Date().toISOString(),
    },
  };

  const supabase = {
    from(table: string) {
      const record = { table, filters: [] as string[] };
      calls.push(record);

      const builder = {
        select: () => builder,
        eq: (column: string, value: string) => {
          record.filters.push(`${column}=${value}`);
          return builder;
        },
        order: () => builder,
        then(
          onFulfilled: (value: QueryResult) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) {
          if (table === TABLES.LISTINGS) {
            return Promise.resolve({ data: [listingRow], error: null }).then(
              onFulfilled,
              onRejected,
            );
          }
          return Promise.resolve({ data: [], error: null }).then(
            onFulfilled,
            onRejected,
          );
        },
      };

      return builder;
    },
  };

  return { supabase: supabase as never, calls };
}

describe("fetchPublicStoreListings", () => {
  it("queries published listings only without user_id filter", async () => {
    const { supabase, calls } = createMockSupabase();
    const listings = await fetchPublicStoreListings(supabase);

    assert.equal(listings.length, 1);
    assert.equal(listings[0]?.title, "Weekly Planner");
    assert.equal(
      listings[0]?.gumroadUrl,
      "https://shop.gumroad.com/l/planner",
    );
    assert.ok(listings[0]?.tags.includes("planner"));

    const listingQuery = calls.find((c) => c.table === TABLES.LISTINGS);
    assert.ok(listingQuery);
    assert.ok(listingQuery.filters.some((f) => f === "status=published"));
    assert.ok(!listingQuery.filters.some((f) => f.startsWith("user_id=")));
  });
});
