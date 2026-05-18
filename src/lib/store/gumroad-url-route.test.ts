import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleGumroadUrlPatch } from "@/lib/store/gumroad-url-route";
import { TABLES } from "@/lib/supabase/schema";

type MockRow = Record<string, unknown>;

function listingRow(overrides: MockRow = {}): MockRow {
  return {
    id: "listing-1",
    user_id: "user-1",
    product_idea_id: "idea-1",
    title: "Meal Prep Planner",
    description: "A useful planner",
    price: 7.99,
    mockup_url: null,
    platform: "gumroad",
    external_listing_id: null,
    gumroad_url: null,
    gumroad_product_id: null,
    status: "approved",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function matchesFilters(row: MockRow, filters: [string, unknown][]) {
  return filters.every(([column, value]) => row[column] === value);
}

class MockQuery {
  private filters: [string, unknown][] = [];
  private patch: MockRow | null = null;
  private columns = "*";

  constructor(
    private readonly table: string,
    private readonly listings: MockRow[],
  ) {}

  select(cols = "*") {
    this.columns = cols;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push([column, value]);
    return this;
  }

  update(patch: MockRow) {
    this.patch = patch;
    return this;
  }

  async single() {
    const rows = this.listings.filter((row) =>
      matchesFilters(row, this.filters),
    );
    const row = rows[0] ?? null;

    if (row && this.patch && this.table === TABLES.LISTINGS) {
      Object.assign(row, this.patch);
    }

    if (
      row &&
      this.patch &&
      this.table === TABLES.LISTINGS &&
      this.columns !== "id, status"
    ) {
      return { data: row, error: null };
    }

    if (this.columns === "id, status" && row) {
      return {
        data: { id: row.id, status: row.status },
        error: null,
      };
    }

    return {
      data: row,
      error: row ? null : { code: "PGRST116", message: "No rows" },
    };
  }
}

function createMockSupabase(seed: {
  userId?: string | null;
  listings?: MockRow[];
}) {
  const listings = seed.listings ?? [listingRow()];

  const supabase = {
    auth: {
      async getUser() {
        return {
          data: {
            user: seed.userId ? { id: seed.userId } : null,
          },
          error: null,
        };
      },
    },
    from(table: string) {
      if (table !== TABLES.LISTINGS) {
        throw new Error(`unexpected table ${table}`);
      }
      return new MockQuery(table, listings);
    },
  };

  return { supabase: supabase as never, listings };
}

function context(id = "listing-1") {
  return { params: Promise.resolve({ id }) };
}

function patchRequest(url: string) {
  return new Request("http://localhost/api", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gumroadUrl: url }),
  });
}

describe("gumroad-url route", () => {
  it("requires auth", async () => {
    const { supabase } = createMockSupabase({ userId: null });

    const response = await handleGumroadUrlPatch(
      patchRequest("https://shop.lemonsqueezy.com/checkout/buy/abc"),
      context(),
      { createSupabaseClient: async () => supabase },
    );

    assert.equal(response.status, 401);
  });

  it("rejects invalid URLs", async () => {
    const { supabase } = createMockSupabase({});

    const response = await handleGumroadUrlPatch(
      patchRequest("not-a-url"),
      context(),
      { createSupabaseClient: async () => supabase },
    );

    assert.equal(response.status, 400);
  });

  it("saves gumroad_url and sets status published when approved", async () => {
    const { supabase, listings } = createMockSupabase({});

    const response = await handleGumroadUrlPatch(
      patchRequest("https://shop.lemonsqueezy.com/checkout/buy/abc"),
      context(),
      { createSupabaseClient: async () => supabase },
    );
    const body = (await response.json()) as {
      ok: boolean;
      gumroadUrl: string;
    };

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(
      body.gumroadUrl,
      "https://shop.lemonsqueezy.com/checkout/buy/abc",
    );
    assert.equal(listings[0]?.gumroad_url, body.gumroadUrl);
    assert.equal(listings[0]?.status, "published");
  });

  it("keeps published status when already published", async () => {
    const { supabase, listings } = createMockSupabase({
      listings: [
        listingRow({
          status: "published",
          gumroad_url: "https://old.example.com/l/old",
        }),
      ],
    });

    const response = await handleGumroadUrlPatch(
      patchRequest("https://creator.gumroad.com/l/new-product"),
      context(),
      { createSupabaseClient: async () => supabase },
    );

    assert.equal(response.status, 200);
    assert.equal(listings[0]?.status, "published");
    assert.equal(
      listings[0]?.gumroad_url,
      "https://creator.gumroad.com/l/new-product",
    );
  });

  it("blocks listings owned by another user", async () => {
    const { supabase } = createMockSupabase({
      listings: [listingRow({ user_id: "user-2" })],
    });

    const response = await handleGumroadUrlPatch(
      patchRequest("https://shop.lemonsqueezy.com/checkout/buy/abc"),
      context(),
      { createSupabaseClient: async () => supabase },
    );

    assert.equal(response.status, 404);
  });
});
