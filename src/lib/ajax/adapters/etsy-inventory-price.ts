/**
 * Etsy inventory price transform — pure functions, no I/O.
 *
 * Why this exists (2026-07-28): three early-July listings have no Printify
 * product linked, so the catalog-driven reset (reprice-and-returns) can never
 * reach them — their Etsy prices kept the old stacked-multiplier values. For
 * listings like these the only price authority is Etsy's inventory endpoint:
 * GET /listings/{id}/inventory → rewrite offering prices → PUT it back.
 *
 * The PUT is a FULL REPLACE of the listing's variation matrix, so the
 * transform is deliberately conservative: it only changes `price`, passes
 * quantity/is_enabled/sku/property_values through, strips the read-only
 * fields Etsy rejects on write (product_id, offering_id, is_deleted,
 * property_name, scale_name), and preserves the *_on_property arrays.
 */

export type EtsyInventoryOffering = {
  offering_id?: number;
  quantity?: number;
  is_enabled?: boolean;
  is_deleted?: boolean;
  price?: { amount?: number; divisor?: number; currency_code?: string };
};

export type EtsyInventoryPropertyValue = {
  property_id?: number;
  property_name?: string | null;
  scale_id?: number | null;
  scale_name?: string | null;
  value_ids?: number[];
  values?: string[];
};

export type EtsyInventoryProduct = {
  product_id?: number;
  sku?: string | null;
  is_deleted?: boolean;
  offerings?: EtsyInventoryOffering[];
  property_values?: EtsyInventoryPropertyValue[];
};

export type EtsyListingInventory = {
  products?: EtsyInventoryProduct[];
  price_on_property?: number[];
  quantity_on_property?: number[];
  sku_on_property?: number[];
};

export type InventoryPriceTargets = {
  /** Price applied to every offering, in cents. */
  basePriceCents: number;
  /** Optional upcharge price (cents) for 2XL-and-up apparel sizes. */
  twoXlPriceCents?: number;
};

export type InventoryPricePayload = {
  products: {
    sku?: string;
    property_values: {
      property_id: number;
      value_ids: number[];
      scale_id?: number;
      values: string[];
    }[];
    offerings: { price: number; quantity: number; is_enabled: boolean }[];
  }[];
  price_on_property: number[];
  quantity_on_property: number[];
  sku_on_property: number[];
};

export type InventoryPricePlan = {
  payload: InventoryPricePayload;
  /** One row per product: what the price moves from/to. */
  changes: {
    label: string;
    oldCents: number[];
    newCents: number;
  }[];
  /** True when every offering already sits at its target — skip the PUT. */
  unchanged: boolean;
  offeringCount: number;
};

const TWO_XL_PATTERN = /^(2\s*x\s*l?|xxl|2xl)$/i;

function priceCents(offering: EtsyInventoryOffering): number {
  const amount = offering.price?.amount;
  const divisor = offering.price?.divisor;
  if (
    typeof amount !== "number" ||
    typeof divisor !== "number" ||
    divisor <= 0
  ) {
    return 0;
  }
  return Math.round((amount / divisor) * 100);
}

function isTwoXlProduct(product: EtsyInventoryProduct): boolean {
  for (const pv of product.property_values ?? []) {
    for (const value of pv.values ?? []) {
      if (TWO_XL_PATTERN.test(value.trim())) return true;
    }
  }
  return false;
}

function productLabel(product: EtsyInventoryProduct): string {
  const parts = (product.property_values ?? [])
    .flatMap((pv) => pv.values ?? [])
    .filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : "(no variations)";
}

/**
 * Builds the PUT payload that sets every offering to its target price and
 * nothing else. Never throws on odd shapes — an empty-products inventory
 * yields an empty payload with unchanged=true so callers naturally skip it.
 */
export function buildInventoryPricePlan(
  inventory: EtsyListingInventory,
  targets: InventoryPriceTargets,
): InventoryPricePlan {
  const products = inventory.products ?? [];
  const changes: InventoryPricePlan["changes"] = [];
  let unchanged = true;
  let offeringCount = 0;

  const sizePropertyIds = new Set<number>();

  const outProducts = products
    .filter((p) => !p.is_deleted)
    .map((product) => {
      const targetCents =
        targets.twoXlPriceCents != null && isTwoXlProduct(product)
          ? targets.twoXlPriceCents
          : targets.basePriceCents;

      if (
        targets.twoXlPriceCents != null &&
        targets.twoXlPriceCents !== targets.basePriceCents &&
        isTwoXlProduct(product)
      ) {
        for (const pv of product.property_values ?? []) {
          if (
            typeof pv.property_id === "number" &&
            (pv.values ?? []).some((v) => TWO_XL_PATTERN.test(v.trim()))
          ) {
            sizePropertyIds.add(pv.property_id);
          }
        }
      }

      const offerings = (product.offerings ?? []).filter(
        (o) => !o.is_deleted,
      );
      offeringCount += offerings.length;
      const oldCents = offerings.map(priceCents);
      if (oldCents.some((c) => c !== targetCents)) unchanged = false;

      changes.push({
        label: productLabel(product),
        oldCents,
        newCents: targetCents,
      });

      const sku = product.sku?.trim();
      return {
        ...(sku ? { sku } : {}),
        property_values: (product.property_values ?? [])
          .filter((pv) => typeof pv.property_id === "number")
          .map((pv) => ({
            property_id: pv.property_id as number,
            value_ids: pv.value_ids ?? [],
            ...(typeof pv.scale_id === "number"
              ? { scale_id: pv.scale_id }
              : {}),
            values: pv.values ?? [],
          })),
        offerings: offerings.map((o) => ({
          price: Number((targetCents / 100).toFixed(2)),
          quantity: typeof o.quantity === "number" ? o.quantity : 999,
          is_enabled: o.is_enabled !== false,
        })),
      };
    });

  // Differing per-size prices require the size property listed in
  // price_on_property; preserve whatever Etsy already had and add the size
  // property only when we actually write a 2XL upcharge.
  const priceOnProperty = new Set(inventory.price_on_property ?? []);
  for (const id of sizePropertyIds) priceOnProperty.add(id);

  return {
    payload: {
      products: outProducts,
      price_on_property: [...priceOnProperty],
      quantity_on_property: inventory.quantity_on_property ?? [],
      sku_on_property: inventory.sku_on_property ?? [],
    },
    changes,
    unchanged: unchanged && outProducts.length > 0,
    offeringCount,
  };
}
