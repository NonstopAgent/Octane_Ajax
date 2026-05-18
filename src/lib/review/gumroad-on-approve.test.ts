import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { publishListingToGumroadOnApprove } from "@/lib/review/gumroad-on-approve";
import type { ProductListing } from "@/lib/ajax/types";
import type { ProductGeneration } from "@/lib/product/domain";

const listing: ProductListing = {
  id: "listing-1",
  userId: "user-1",
  productIdeaId: "idea-1",
  title: "Meal Prep Planner",
  description: "A useful planner",
  price: 7.99,
  mockupUrl: null,
  platform: "gumroad",
  externalListingId: null,
  gumroadUrl: null,
  gumroadProductId: null,
  status: "approved",
  createdAt: new Date().toISOString(),
};

const generation: ProductGeneration = {
  id: "gen-1",
  userId: "user-1",
  productListingId: "listing-1",
  productIdeaId: "idea-1",
  generationStatus: "ready",
  structure: { format: "planner", pageCount: 1, pages: [] },
  complianceFlags: [],
  complianceWarnings: [],
  llm: {
    provider: null,
    model: null,
    promptVersion: null,
    tokenEstimateInput: null,
    tokenEstimateOutput: null,
  },
  pdf: { storagePath: "user-1/gen-1.pdf", publicUrl: null },
  mockupStoragePath: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function makeSupabase(events: unknown[]) {
  return {
    from(table: string) {
      if (table === "factory_events") {
        return {
          insert(payload: unknown) {
            events.push(payload);
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

describe("publishListingToGumroadOnApprove", () => {
  const originalApiKey = process.env.LEMONSQUEEZY_API_KEY;

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.LEMONSQUEEZY_API_KEY;
    } else {
      process.env.LEMONSQUEEZY_API_KEY = originalApiKey;
    }
  });

  it("logs gumroad_skipped when Lemon Squeezy API key is missing", async () => {
    delete process.env.LEMONSQUEEZY_API_KEY;
    const events: unknown[] = [];

    const result = await publishListingToGumroadOnApprove({
      supabase: makeSupabase(events) as never,
      userId: "user-1",
      listingId: listing.id,
      listing,
      generation,
    });

    assert.equal(result, null);
    const event = events[0] as { event_type: string };
    assert.equal(event.event_type, "gumroad_skipped");
  });

  it("logs gumroad_publish_failed when PDF path is missing", async () => {
    process.env.LEMONSQUEEZY_API_KEY = "test-key";
    const events: unknown[] = [];

    const result = await publishListingToGumroadOnApprove({
      supabase: makeSupabase(events) as never,
      userId: "user-1",
      listingId: listing.id,
      listing,
      generation: {
        ...generation,
        pdf: { ...generation.pdf, storagePath: null },
      },
    });

    assert.equal(result, null);
    const event = events[0] as { event_type: string };
    assert.equal(event.event_type, "gumroad_publish_failed");
  });

  it("never throws — approval flow can continue", async () => {
    delete process.env.LEMONSQUEEZY_API_KEY;
    await assert.doesNotReject(() =>
      publishListingToGumroadOnApprove({
        supabase: makeSupabase([]) as never,
        userId: "user-1",
        listingId: listing.id,
        listing,
        generation: null,
      }),
    );
  });
});
