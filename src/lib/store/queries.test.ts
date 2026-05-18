import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchStoreListings } from "@/lib/store/queries";
import { STORE_LISTING_STATUSES } from "@/lib/store/types";
import { TABLES } from "@/lib/supabase/schema";

type QueryResult = {
  data: unknown;
  error: null;
};

function createMockSupabase(userId: string) {
  const calls: { table: string; filters: string[]; inValues: string[][] }[] = [];

  const listingRow = {
    id: "listing-1",
    user_id: userId,
    title: "Demo Planner",
    description: "A focused printable.",
    status: "published",
    price: 24.99,
    platform: "demo",
    gumroad_url: null,
    product_idea_id: "idea-1",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    product_ideas: {
      id: "idea-1",
      user_id: userId,
      title: "Demo Planner Idea",
      niche: "solo operators",
      description: "Helps track weekly goals.",
      format: "planner",
      category: "productivity",
      trend_score: 80,
      status: "selected",
      seo_keywords: ["planner", "goals"],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  };

  const supabase = {
    from(table: string) {
      const record = { table, filters: [] as string[], inValues: [] as string[][] };
      calls.push(record);

      const builder = {
        select: () => builder,
        eq: (column: string, value: string) => {
          record.filters.push(`${column}=${value}`);
          return builder;
        },
        in: (column: string, values: string[]) => {
          record.inValues.push([column, ...values]);
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
          if (table === TABLES.GENERATIONS) {
            return Promise.resolve({ data: [], error: null }).then(
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

  return { supabase: supabase as never, calls, userId };
}

describe("fetchStoreListings", () => {
  it("queries approved and published listings for the operator storefront", async () => {
    const { supabase, calls, userId } = createMockSupabase("user-1");
    const listings = await fetchStoreListings(supabase, userId);

    assert.equal(listings.length, 1);
    assert.equal(listings[0]?.listing.title, "Demo Planner");
    assert.equal(listings[0]?.displayStatus, "published");
    assert.ok(listings[0]?.tags.length >= 1);

    const listingQuery = calls.find((c) => c.table === TABLES.LISTINGS);
    assert.ok(listingQuery);
    assert.ok(listingQuery.filters.some((f) => f === `user_id=${userId}`));
    const statusIn = listingQuery.inValues.find(([col]) => col === "status");
    assert.ok(statusIn);
    for (const status of STORE_LISTING_STATUSES) {
      assert.ok(statusIn.includes(status));
    }
  });
});
