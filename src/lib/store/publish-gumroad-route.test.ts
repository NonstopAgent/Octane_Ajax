import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LemonSqueezyAdapterError } from "@/lib/ajax/adapters/lemonsqueezy";
import { handlePublishGumroadRequest } from "@/lib/store/publish-gumroad-route";
import { TABLES } from "@/lib/supabase/schema";

type MockRow = Record<string, unknown>;

type MockState = {
  userId: string | null;
  listings: MockRow[];
  generations: MockRow[];
  events: MockRow[];
  updates: MockRow[];
};

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

function generationRow(overrides: MockRow = {}): MockRow {
  return {
    id: "gen-1",
    user_id: "user-1",
    product_idea_id: "idea-1",
    product_listing_id: "listing-1",
    structure: {
      blueprintId: 68,
      printProviderId: 1,
      variantIds: [33719],
      artworkPrompt: "Test artwork prompt for legacy gumroad route test",
      aestheticStyle: "minimalist-line-art",
    },
    llm_provider: null,
    llm_model: null,
    prompt_version: null,
    token_estimate_input: null,
    token_estimate_output: null,
    generation_status: "ready",
    pdf_storage_path: "user-1/gen-1.pdf",
    pdf_public_url: null,
    compliance_flags: [],
    compliance_warnings: [],
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

  constructor(
    private readonly table: string,
    private readonly state: MockState,
  ) {}

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push([column, value]);
    return this;
  }

  order() {
    return this;
  }

  update(patch: MockRow) {
    this.patch = patch;
    return this;
  }

  insert(payload: MockRow) {
    if (this.table === TABLES.EVENTS) {
      this.state.events.push(payload);
    }
    return Promise.resolve({ data: null, error: null });
  }

  async single() {
    const rows = this.rows();
    const row = rows[0] ?? null;

    if (row && this.patch && this.table === TABLES.LISTINGS) {
      Object.assign(row, this.patch);
      this.state.updates.push(this.patch);
    }

    return {
      data: row,
      error: row ? null : { code: "PGRST116", message: "No rows" },
    };
  }

  then(
    onFulfilled: (value: { data: MockRow[]; error: null }) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) {
    return Promise.resolve({ data: this.rows(), error: null }).then(
      onFulfilled,
      onRejected,
    );
  }

  private rows() {
    const source =
      this.table === TABLES.LISTINGS
        ? this.state.listings
        : this.table === TABLES.GENERATIONS
          ? this.state.generations
          : [];
    return source.filter((row) => matchesFilters(row, this.filters));
  }
}

function createMockSupabase(seed: Partial<MockState>) {
  const state: MockState = {
    userId: seed.userId === undefined ? "user-1" : seed.userId,
    listings: seed.listings ?? [listingRow()],
    generations: seed.generations ?? [generationRow()],
    events: [],
    updates: [],
  };

  const supabase = {
    auth: {
      async getUser() {
        return {
          data: {
            user: state.userId ? { id: state.userId } : null,
          },
          error: null,
        };
      },
    },
    from(table: string) {
      return new MockQuery(table, state);
    },
  };

  return { supabase: supabase as never, state };
}

function context(id = "listing-1") {
  return { params: Promise.resolve({ id }) };
}

async function responseJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

function lemonSqueezyAdapterMock() {
  return {
    async createProduct() {
      return { product_id: "ls-product-1", buy_now_url: null };
    },
    async getDefaultVariant() {
      return { variant_id: "ls-variant-1" };
    },
    async setVariantPrice() {},
    async uploadFile() {},
    async publishProduct() {
      return {
        product_id: "ls-product-1",
        buy_now_url: "https://store.lemonsqueezy.com/checkout/buy/meal-prep",
      };
    },
  };
}

describe("publish-gumroad route", () => {
  it("requires auth", async () => {
    const { supabase } = createMockSupabase({ userId: null });

    const response = await handlePublishGumroadRequest(context(), {
      createSupabaseClient: async () => supabase,
    });

    assert.equal(response.status, 401);
    assert.equal((await responseJson(response)).error, "Unauthorized");
  });

  it("blocks listings owned by another user", async () => {
    const { supabase } = createMockSupabase({
      userId: "user-1",
      listings: [listingRow({ user_id: "user-2" })],
    });

    const response = await handlePublishGumroadRequest(context(), {
      createSupabaseClient: async () => supabase,
    });

    assert.equal(response.status, 404);
    assert.equal((await responseJson(response)).status, "not_found");
  });

  it("blocks missing or failed PDFs", async () => {
    const { supabase, state } = createMockSupabase({
      generations: [
        generationRow({
          generation_status: "failed",
          pdf_storage_path: "user-1/failed.pdf",
        }),
        generationRow({ id: "gen-2", pdf_storage_path: null }),
      ],
    });

    const response = await handlePublishGumroadRequest(context(), {
      createSupabaseClient: async () => supabase,
    });
    const body = await responseJson(response);

    assert.equal(response.status, 409);
    assert.equal(body.status, "missing_pdf");
    assert.equal(state.updates.length, 0);
    assert.equal(state.events.at(-1)?.event_type, "gumroad_publish_failed");
  });

  it("saves gumroad_url and gumroad_product_id on success", async () => {
    const { supabase, state } = createMockSupabase({});

    const response = await handlePublishGumroadRequest(context(), {
      createSupabaseClient: async () => supabase,
      gumroad: {
        apiKey: "test-key",
        downloadPdf: async () => Buffer.from("%PDF"),
        createAdapter: () => lemonSqueezyAdapterMock(),
      },
    });
    const body = await responseJson(response);

    assert.equal(response.status, 200);
    assert.equal(
      body.url,
      "https://store.lemonsqueezy.com/checkout/buy/meal-prep",
    );
    assert.equal(body.productId, "ls-product-1");
    assert.equal(
      state.listings[0]?.gumroad_url,
      "https://store.lemonsqueezy.com/checkout/buy/meal-prep",
    );
    assert.equal(state.listings[0]?.gumroad_product_id, "ls-product-1");
    assert.equal(state.listings[0]?.status, "published");
    assert.equal(state.events.at(-1)?.event_type, "gumroad_published");
  });

  it("does not delete or unpublish the listing when store publish fails", async () => {
    const { supabase, state } = createMockSupabase({
      listings: [listingRow({ status: "published" })],
    });

    const response = await handlePublishGumroadRequest(context(), {
      createSupabaseClient: async () => supabase,
      gumroad: {
        apiKey: "test-key",
        downloadPdf: async () => Buffer.from("%PDF"),
        createAdapter: () => ({
          async createProduct() {
            throw new LemonSqueezyAdapterError("Lemon Squeezy unavailable.", 500);
          },
          async getDefaultVariant() {
            return { variant_id: "x" };
          },
          async setVariantPrice() {},
          async uploadFile() {},
          async publishProduct() {
            return { product_id: "x", buy_now_url: "https://example.com" };
          },
        }),
      },
    });
    const body = await responseJson(response);

    assert.equal(response.status, 502);
    assert.equal(body.status, "failed");
    assert.equal(state.listings.length, 1);
    assert.equal(state.listings[0]?.status, "published");
    assert.equal(state.listings[0]?.gumroad_url, null);
    assert.equal(state.updates.length, 0);
    assert.equal(state.events.at(-1)?.event_type, "gumroad_publish_failed");
  });
});
