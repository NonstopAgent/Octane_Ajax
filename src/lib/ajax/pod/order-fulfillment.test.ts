import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDemoPrintifyAdapter } from "@/lib/ajax/adapters/printify";
import {
  mapEtsyShippingToPrintify,
  pickVariantForBuyer,
  resolveShippingFromOrderMetadata,
  runOrderProductionFulfillment,
} from "@/lib/ajax/pod/order-fulfillment";
import type { OrderQueueRow } from "@/lib/ajax/pod/order-types";

function baseOrder(overrides: Partial<OrderQueueRow> = {}): OrderQueueRow {
  return {
    id: "order-uuid",
    user_id: "user-uuid",
    etsy_order_id: "12345",
    transaction_id: "",
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

describe("pickVariantForBuyer (H6)", () => {
  const CATALOG = [
    { id: 18052, title: "Aqua / S" },
    { id: 18053, title: "Aqua / M" },
    { id: 18054, title: "Aqua / L" },
    { id: 18055, title: "Aqua / XL" },
    { id: 18056, title: "Aqua / 2XL" },
  ];
  const ENABLED = [18052, 18053, 18054, 18055, 18056];

  it("maps the buyer's size to the matching variant", () => {
    const picked = pickVariantForBuyer(ENABLED, CATALOG, [
      { name: "Size", value: "2XL" },
    ]);
    assert.deepEqual(picked, { variantId: 18056, matched: true });
  });

  it("never lets XL substring-match 2XL", () => {
    const picked = pickVariantForBuyer(ENABLED, CATALOG, [
      { name: "Size", value: "XL" },
    ]);
    assert.deepEqual(picked, { variantId: 18055, matched: true });
  });

  it("matches dimension formats across punctuation (12\" x 18\")", () => {
    const posters = [
      { id: 43135, title: '11" x 14" (Vertical) / Matte' },
      { id: 43138, title: '12" x 18" (Vertical) / Matte' },
      { id: 43144, title: '18" x 24" (Vertical) / Matte' },
    ];
    const picked = pickVariantForBuyer(
      [43135, 43138, 43144],
      posters,
      [{ name: "Size", value: "12x18" }],
    );
    assert.deepEqual(picked, { variantId: 43138, matched: true });
  });

  it("falls back unmatched when the buyer chose nothing usable", () => {
    assert.deepEqual(pickVariantForBuyer(ENABLED, CATALOG, []), {
      variantId: 18052,
      matched: false,
    });
    assert.deepEqual(
      pickVariantForBuyer(ENABLED, CATALOG, [
        { name: "Size", value: "Toddler 4T" },
      ]),
      { variantId: 18052, matched: false },
    );
  });
});

describe("production shipping guard (C3)", () => {
  it("refuses the demo address at submit time when the fallback is disallowed", () => {
    assert.throws(
      () =>
        resolveShippingFromOrderMetadata(
          baseOrder({ metadata: {}, etsy_order_id: "prod-1" }),
          { allowDemoFallback: false },
        ),
      /refusing to submit production/,
    );
  });

  it("keeps the demo fallback for local/dev flows", () => {
    const demo = resolveShippingFromOrderMetadata(
      baseOrder({ metadata: {}, etsy_order_id: "dev-1" }),
      { allowDemoFallback: true },
    );
    assert.equal(demo.address1, "123 Demo Street");
  });
});

describe("order production — buyer variant + per-item external id", () => {
  it("submits the buyer's chosen variant and a per-transaction external id", async () => {
    const printify = createDemoPrintifyAdapter();
    const submitted: unknown[] = [];
    const spied = {
      ...printify,
      async listCatalogVariants() {
        return {
          mode: "demo" as const,
          message: "stub",
          data: [
            { id: 18052, title: "Aqua / S" },
            { id: 18056, title: "Aqua / 2XL" },
          ],
          handledAt: new Date().toISOString(),
        };
      },
      async submitOrder(input: Parameters<typeof printify.submitOrder>[0]) {
        submitted.push(input);
        return printify.submitOrder(input);
      },
    };

    const result = await runOrderProductionFulfillment(
      {} as never,
      "user-uuid",
      {
        order: baseOrder({
          transaction_id: "9002",
          metadata: {
            etsyListingId: "888",
            quantity: 1,
            buyerVariations: [{ name: "Size", value: "2XL" }],
            etsyShipping: {
              firstName: "Jane",
              lastName: "Doe",
              country: "US",
              address1: "99 Broadway",
              city: "New York",
              zip: "10001",
            },
          },
        }),
        listingContext: {
          listingId: "listing-uuid",
          title: "Personalized Tee",
          description: "Custom POD tee",
          podDetails: {
            blueprintId: 12,
            printProviderId: 29,
            variantIds: [18052, 18053, 18054, 18055, 18056],
            artworkPrompt: "Original artwork.",
            aestheticStyle: "screen-print",
          },
          printifyProductId: "pfy-prod-existing",
        },
      },
      { printify: spied },
    );

    assert.equal(result.variantId, 18056);
    assert.equal(result.variantMatch, "buyer");
    assert.equal(result.variantWarning, null);
    const call = submitted[0] as { externalId: string; lineItems: { variantId: number }[] };
    assert.equal(call.externalId, "etsy-12345-9002");
    assert.equal(call.lineItems[0]?.variantId, 18056);
  });

  it("warns loudly when the buyer chose options but nothing matched", async () => {
    const printify = createDemoPrintifyAdapter();
    const spied = {
      ...printify,
      async listCatalogVariants() {
        return {
          mode: "demo" as const,
          message: "stub",
          data: [{ id: 18052, title: "Aqua / S" }],
          handledAt: new Date().toISOString(),
        };
      },
    };

    const result = await runOrderProductionFulfillment(
      {} as never,
      "user-uuid",
      {
        order: baseOrder({
          metadata: {
            etsyListingId: "888",
            quantity: 1,
            buyerVariations: [{ name: "Size", value: "5XL" }],
            etsyShipping: {
              firstName: "Jane",
              lastName: "Doe",
              country: "US",
              address1: "99 Broadway",
              city: "New York",
              zip: "10001",
            },
          },
        }),
        listingContext: {
          listingId: "listing-uuid",
          title: "Personalized Tee",
          description: "Custom POD tee",
          podDetails: {
            blueprintId: 12,
            printProviderId: 29,
            variantIds: [18052, 18053],
            artworkPrompt: "Original artwork.",
            aestheticStyle: "screen-print",
          },
          printifyProductId: "pfy-prod-existing",
        },
      },
      { printify: spied },
    );

    assert.equal(result.variantId, 18052);
    assert.equal(result.variantMatch, "default");
    assert.match(result.variantWarning ?? "", /no catalog variant matched/);
  });
});
