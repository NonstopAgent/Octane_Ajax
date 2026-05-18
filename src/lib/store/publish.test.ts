import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeGumroadUrl,
  normalizeManualCheckoutUrl,
  publishListingWithGumroad,
  saveManualListingCheckoutUrl,
  StorePublishError,
} from "@/lib/store/publish";
import { TABLES } from "@/lib/supabase/schema";

describe("normalizeGumroadUrl", () => {
  it("accepts https gumroad product URLs", () => {
    const url = normalizeGumroadUrl("https://creator.gumroad.com/l/my-product");
    assert.equal(url, "https://creator.gumroad.com/l/my-product");
  });

  it("rejects non-gumroad hosts", () => {
    assert.throws(
      () => normalizeGumroadUrl("https://example.com/product"),
      StorePublishError,
    );
  });
});

describe("normalizeManualCheckoutUrl", () => {
  it("accepts https checkout URLs loosely", () => {
    const url = normalizeManualCheckoutUrl(
      "https://store.lemonsqueezy.com/checkout/buy/abc",
    );
    assert.equal(url, "https://store.lemonsqueezy.com/checkout/buy/abc");
  });

  it("rejects non-https URLs", () => {
    assert.throws(
      () => normalizeManualCheckoutUrl("http://example.com/product"),
      StorePublishError,
    );
  });
});

describe("saveManualListingCheckoutUrl", () => {
  it("persists gumroad_url and sets status published when approved", async () => {
    let updatePayload: Record<string, unknown> | null = null;

    const supabase = {
      from(table: string) {
        const builder = {
          select: () => builder,
          eq: () => builder,
          single: () =>
            Promise.resolve({
              data: { id: "listing-1", status: "approved" },
              error: null,
            }),
          update: (payload: Record<string, unknown>) => {
            updatePayload = payload;
            const afterEq = {
              select: () => ({
                single: () =>
                  Promise.resolve({
                    data: {
                      id: "listing-1",
                      user_id: "user-1",
                      product_idea_id: "idea-1",
                      title: "Planner",
                      description: null,
                      price: 10,
                      mockup_url: null,
                      platform: "demo",
                      external_listing_id: null,
                      gumroad_url: payload.gumroad_url,
                      gumroad_product_id: null,
                      status: "published",
                      created_at: new Date().toISOString(),
                    },
                    error: null,
                  }),
              }),
            };
            return {
              eq: () => ({
                eq: () => afterEq,
              }),
            };
          },
        };
        if (table !== TABLES.LISTINGS) {
          throw new Error(`unexpected table ${table}`);
        }
        return builder;
      },
    };

    const result = await saveManualListingCheckoutUrl(
      supabase as never,
      "user-1",
      "listing-1",
      "https://store.lemonsqueezy.com/checkout/buy/abc",
    );

    assert.equal(result.listing.status, "published");
    assert.equal(
      result.listing.gumroadUrl,
      "https://store.lemonsqueezy.com/checkout/buy/abc",
    );
    assert.equal(updatePayload?.status, "published");
  });

  it("does not change status when already published", async () => {
    let updatePayload: Record<string, unknown> | null = null;

    const supabase = {
      from(table: string) {
        const builder = {
          select: () => builder,
          eq: () => builder,
          single: () =>
            Promise.resolve({
              data: { id: "listing-1", status: "published" },
              error: null,
            }),
          update: (payload: Record<string, unknown>) => {
            updatePayload = payload;
            const afterEq = {
              select: () => ({
                single: () =>
                  Promise.resolve({
                    data: {
                      id: "listing-1",
                      user_id: "user-1",
                      product_idea_id: "idea-1",
                      title: "Planner",
                      description: null,
                      price: 10,
                      mockup_url: null,
                      platform: "demo",
                      external_listing_id: null,
                      gumroad_url: payload.gumroad_url,
                      gumroad_product_id: null,
                      status: "published",
                      created_at: new Date().toISOString(),
                    },
                    error: null,
                  }),
              }),
            };
            return {
              eq: () => ({
                eq: () => afterEq,
              }),
            };
          },
        };
        if (table !== TABLES.LISTINGS) {
          throw new Error(`unexpected table ${table}`);
        }
        return builder;
      },
    };

    await saveManualListingCheckoutUrl(
      supabase as never,
      "user-1",
      "listing-1",
      "https://creator.gumroad.com/l/new",
    );

    assert.equal(updatePayload?.status, undefined);
    assert.equal(
      updatePayload?.gumroad_url,
      "https://creator.gumroad.com/l/new",
    );
  });
});

describe("publishListingWithGumroad", () => {
  it("persists gumroad_url and sets status published", async () => {
    let updatePayload: Record<string, unknown> | null = null;

    const supabase = {
      from(table: string) {
        const builder = {
          select: () => builder,
          eq: () => builder,
          single: () =>
            Promise.resolve({
              data: { id: "listing-1", status: "approved" },
              error: null,
            }),
          update: (payload: Record<string, unknown>) => {
            updatePayload = payload;
            const afterEq = {
              select: () => ({
                single: () =>
                  Promise.resolve({
                    data: {
                      id: "listing-1",
                      user_id: "user-1",
                      product_idea_id: "idea-1",
                      title: "Planner",
                      description: null,
                      price: 10,
                      mockup_url: null,
                      platform: "demo",
                      external_listing_id: null,
                      gumroad_url: payload.gumroad_url,
                      status: "published",
                      created_at: new Date().toISOString(),
                    },
                    error: null,
                  }),
              }),
            };
            return {
              eq: () => ({
                eq: () => afterEq,
              }),
            };
          },
        };
        if (table !== TABLES.LISTINGS) {
          throw new Error(`unexpected table ${table}`);
        }
        return builder;
      },
    };

    const result = await publishListingWithGumroad(
      supabase as never,
      "user-1",
      "listing-1",
      "https://shop.gumroad.com/l/planner",
    );

    assert.equal(result.listing.status, "published");
    assert.equal(
      result.listing.gumroadUrl,
      "https://shop.gumroad.com/l/planner",
    );
    assert.equal(updatePayload?.status, "published");
    assert.equal(
      updatePayload?.gumroad_url,
      "https://shop.gumroad.com/l/planner",
    );
  });
});
