import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { publishListingToEtsyOnApprove } from "@/lib/review/etsy-on-approve";
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
  platform: "etsy",
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

describe("publishListingToEtsyOnApprove", () => {
  it("logs etsy_skipped when Etsy is not connected", async () => {
    const events: unknown[] = [];

    const result = await publishListingToEtsyOnApprove(
      {
        supabase: makeSupabase(events) as never,
        userId: "user-1",
        listingId: listing.id,
        listing,
        generation,
      },
      {
        refreshToken: async () => null,
      },
    );

    assert.equal(result, null);
    const event = events[0] as { event_type: string };
    assert.equal(event.event_type, "etsy_skipped");
  });

  it("logs etsy_publish_failed when PDF path is missing", async () => {
    const events: unknown[] = [];

    const result = await publishListingToEtsyOnApprove(
      {
        supabase: makeSupabase(events) as never,
        userId: "user-1",
        listingId: listing.id,
        listing,
        generation: {
          ...generation,
          pdf: { ...generation.pdf, storagePath: null },
        },
      },
      {
        refreshToken: async () => ({
          access_token: "1.token",
          refresh_token: "1.refresh",
          shop_id: "shop-1",
          expires_at: new Date(Date.now() + 7200_000).toISOString(),
        }),
      },
    );

    assert.equal(result, null);
    const event = events[0] as { event_type: string };
    assert.equal(event.event_type, "etsy_publish_failed");
  });

  it("never throws when Etsy publish fails", async () => {
    const events: unknown[] = [];

    await assert.doesNotReject(() =>
      publishListingToEtsyOnApprove(
        {
          supabase: makeSupabase(events) as never,
          userId: "user-1",
          listingId: listing.id,
          listing,
          generation,
        },
        {
          refreshToken: async () => ({
            access_token: "1.token",
            refresh_token: "1.refresh",
            shop_id: "shop-1",
            expires_at: new Date(Date.now() + 7200_000).toISOString(),
          }),
          downloadPdf: async () => {
            throw new Error("storage down");
          },
        },
      ),
    );

    const event = events[0] as { event_type: string };
    assert.equal(event.event_type, "etsy_publish_failed");
  });
});
