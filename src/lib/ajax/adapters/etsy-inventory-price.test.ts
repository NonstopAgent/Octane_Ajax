import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildInventoryPricePlan,
  type EtsyListingInventory,
} from "@/lib/ajax/adapters/etsy-inventory-price";

function offering(cents: number, quantity = 999): {
  offering_id: number;
  quantity: number;
  is_enabled: boolean;
  price: { amount: number; divisor: number; currency_code: string };
} {
  return {
    offering_id: Math.floor(cents * 7 + quantity),
    quantity,
    is_enabled: true,
    price: { amount: cents, divisor: 100, currency_code: "USD" },
  };
}

const SWEATSHIRT: EtsyListingInventory = {
  products: [
    {
      product_id: 11,
      sku: "",
      is_deleted: false,
      offerings: [offering(5399)],
      property_values: [
        {
          property_id: 100,
          property_name: "Size",
          scale_id: 301,
          scale_name: null,
          value_ids: [1213],
          values: ["S"],
        },
      ],
    },
    {
      product_id: 12,
      sku: "",
      is_deleted: false,
      offerings: [offering(5399, 500)],
      property_values: [
        {
          property_id: 100,
          property_name: "Size",
          scale_id: 301,
          scale_name: null,
          value_ids: [1216],
          values: ["2XL"],
        },
      ],
    },
  ],
  price_on_property: [100],
  quantity_on_property: [],
  sku_on_property: [],
};

describe("buildInventoryPricePlan", () => {
  it("sets every offering to the flat target and strips read-only fields", () => {
    const plan = buildInventoryPricePlan(SWEATSHIRT, {
      basePriceCents: 3999,
    });

    assert.equal(plan.unchanged, false);
    assert.equal(plan.offeringCount, 2);
    const json = JSON.stringify(plan.payload);
    assert.doesNotMatch(json, /product_id|offering_id|is_deleted|property_name|scale_name|amount|divisor/);
    for (const product of plan.payload.products) {
      assert.equal(product.offerings[0]?.price, 39.99);
    }
    // quantity + enablement pass through untouched
    assert.equal(plan.payload.products[1]?.offerings[0]?.quantity, 500);
    assert.equal(plan.payload.products[0]?.offerings[0]?.is_enabled, true);
    // existing price_on_property preserved
    assert.deepEqual(plan.payload.price_on_property, [100]);
  });

  it("applies the 2XL upcharge and keeps the size property in price_on_property", () => {
    const plan = buildInventoryPricePlan(SWEATSHIRT, {
      basePriceCents: 2999,
      twoXlPriceCents: 3199,
    });

    assert.equal(plan.payload.products[0]?.offerings[0]?.price, 29.99);
    assert.equal(plan.payload.products[1]?.offerings[0]?.price, 31.99);
    assert.ok(plan.payload.price_on_property.includes(100));
  });

  it("adds the size property to price_on_property when Etsy had none", () => {
    const flat: EtsyListingInventory = {
      ...SWEATSHIRT,
      price_on_property: [],
    };
    const plan = buildInventoryPricePlan(flat, {
      basePriceCents: 2999,
      twoXlPriceCents: 3199,
    });
    assert.deepEqual(plan.payload.price_on_property, [100]);
  });

  it("reports unchanged when every offering already sits at target", () => {
    const done: EtsyListingInventory = {
      products: [
        {
          product_id: 1,
          offerings: [offering(3999)],
          property_values: [
            { property_id: 100, value_ids: [1], values: ["S"] },
          ],
        },
      ],
      price_on_property: [100],
    };
    const plan = buildInventoryPricePlan(done, { basePriceCents: 3999 });
    assert.equal(plan.unchanged, true);
  });

  it("filters deleted products and offerings; empty inventory is not writable", () => {
    const withDeleted: EtsyListingInventory = {
      products: [
        { product_id: 1, is_deleted: true, offerings: [offering(1000)] },
        {
          product_id: 2,
          offerings: [{ ...offering(5399), is_deleted: true }],
          property_values: [],
        },
      ],
    };
    const plan = buildInventoryPricePlan(withDeleted, {
      basePriceCents: 3999,
    });
    assert.equal(plan.payload.products.length, 1);
    assert.equal(plan.offeringCount, 0);

    const empty = buildInventoryPricePlan({}, { basePriceCents: 3999 });
    assert.equal(empty.offeringCount, 0);
    assert.equal(empty.unchanged, false);
  });

  it("keeps a non-empty sku and omits blank ones", () => {
    const withSku: EtsyListingInventory = {
      products: [
        {
          product_id: 1,
          sku: "TEE-S",
          offerings: [offering(3999)],
          property_values: [
            { property_id: 100, value_ids: [1], values: ["S"] },
          ],
        },
        {
          product_id: 2,
          sku: "",
          offerings: [offering(3999)],
          property_values: [
            { property_id: 100, value_ids: [2], values: ["M"] },
          ],
        },
      ],
    };
    const plan = buildInventoryPricePlan(withSku, { basePriceCents: 2999 });
    assert.equal(plan.payload.products[0]?.sku, "TEE-S");
    assert.ok(!("sku" in plan.payload.products[1]!));
  });

  it("recognizes XXL and '2 X L' spellings as the upcharge size", () => {
    const spellings: EtsyListingInventory = {
      products: ["XXL", "2 X L", "L"].map((size, i) => ({
        product_id: i,
        offerings: [offering(2999)],
        property_values: [
          { property_id: 100, value_ids: [i], values: [size] },
        ],
      })),
      price_on_property: [100],
    };
    const plan = buildInventoryPricePlan(spellings, {
      basePriceCents: 2999,
      twoXlPriceCents: 3199,
    });
    assert.equal(plan.payload.products[0]?.offerings[0]?.price, 31.99);
    assert.equal(plan.payload.products[1]?.offerings[0]?.price, 31.99);
    assert.equal(plan.payload.products[2]?.offerings[0]?.price, 29.99);
  });
});
