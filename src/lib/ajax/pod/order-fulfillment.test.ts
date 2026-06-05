import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDemoPrintifyAdapter } from "@/lib/ajax/adapters/printify";
import {
  mapEtsyShippingToPrintify,
  resolveShippingFromOrderMetadata,
  runOrderProductionFulfillment,
} from "@/lib/ajax/pod/order-fulfillment";
import type { OrderQueueRow } from "@/lib/ajax/pod/order-types";

function baseOrder(overrides: Partial<OrderQueueRow> = {}): OrderQueueRow {
  return {
    id: "order-uuid",
    user_id: "user-uuid",
    etsy_order_id: "12345",
    listing_id: null,
    customer_photo_url: "demo://photo.png",
    style_prompt: "Original portrait artwork.",
    status: "fulfillment_ready",
    printify_product_id: null,
    printify_upload_id: "pfy-art-test",
    artwork_url: "demo://art.png",
    error_message: null,
    metadata: {
      etsyListingId: "888",
      quantity: 1,
      etsyShipping: {
        firstName: "Jane",
        lastName: "Doe",
        email: "jane@example.com",
        country: "US",
        region: "NY",
        address1: "99 Broadway",
        city: "New York",
        zip: "10001",
      },
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("order-fulfillment", () => {
  it("maps Etsy shipping to Printify address_to shape", () => {
    const mapped = mapEtsyShippingToPrintify({
      firstName: "Jane",
      lastName: "Doe",
      email: "jane@example.com",
      phone: null,
      country: "US",
      region: "NY",
      address1: "99 Broadway",
      address2: null,
      city: "New York",
      zip: "10001",
    });

    assert.equal(mapped.firstName, "Jane");
    assert.equal(mapped.country, "US");
    assert.equal(mapped.address1, "99 Broadway");
  });

  it("resolves shipping from order metadata with demo fallback", () => {
    const fromMeta = resolveShippingFromOrderMetadata(baseOrder());
    assert.equal(fromMeta.firstName, "Jane");
    assert.equal(fromMeta.city, "New York");

    const demo = resolveShippingFromOrderMetadata(
      baseOrder({ metadata: {}, etsy_order_id: "demo-1" }),
    );
    assert.equal(demo.firstName, "Demo");
    assert.equal(demo.country, "US");
  });

  it("submits demo Printify production for a fulfillment_ready order", async () => {
    const printify = createDemoPrintifyAdapter();
    const result = await runOrderProductionFulfillment(
      {} as never,
      "user-uuid",
      {
        order: baseOrder(),
        listingContext: {
          listingId: "listing-uuid",
          title: "Personalized Portrait",
          description: "Custom POD portrait",
          podDetails: {
            blueprintId: 68,
            printProviderId: 1,
            variantIds: [33719],
            artworkPrompt: "Original portrait artwork.",
            aestheticStyle: "watercolor",
          },
          printifyProductId: null,
        },
      },
      { printify },
    );

    assert.match(result.printifyProductId, /^pfy-prod-/);
    assert.match(result.printifyOrderId, /^pfy-ord-/);
    assert.equal(result.adapterModes.printify, "demo");
    assert.equal(result.quantity, 1);
  });
});
