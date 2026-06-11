/**
 * Printify product catalog — the ONLY source of blueprint / print provider /
 * variant IDs in the system.
 *
 * Forge (the LLM) never outputs raw Printify IDs. It selects a `catalogKey`
 * from this pre-approved list, and the backend resolves it to exact,
 * known-good IDs. This makes every Printify createProduct call structurally
 * valid by construction.
 *
 * ⚠️ VERIFY THE IDS AGAINST YOUR PRINTIFY ACCOUNT BEFORE FIRST LIVE RUN.
 * Variant IDs are provider-specific. Use `node scripts/get-printify-shop.mjs`
 * or the Printify API:
 *   GET /v1/catalog/blueprints/{id}/print_providers.json
 *   GET /v1/catalog/blueprints/{id}/print_providers/{id}/variants.json
 * Then update the entries below — nothing else in the codebase needs to change.
 */

import type { ProductFormat } from "@/lib/ajax/product-brain/types";

export const PRINTIFY_CATALOG_KEYS = [
  "MUG_11OZ",
  "POSTER_MATTE_VERTICAL",
  "TEE_UNISEX",
  "SWEATSHIRT_CREWNECK",
] as const;

export type PrintifyCatalogKey = (typeof PRINTIFY_CATALOG_KEYS)[number];

export type PrintifyCatalogEntry = {
  key: PrintifyCatalogKey;
  label: string;
  /** Printify blueprint ID. */
  blueprintId: number;
  /** Printify print provider ID for this blueprint. */
  printProviderId: number;
  /** Enabled variant IDs (must belong to this blueprint+provider combo). */
  variantIds: number[];
  /** Default retail price in cents when Forge's price is missing/invalid. */
  defaultPriceCents: number;
  /** Hint for Forge about when to pick this product. */
  promptHint: string;
};

/**
 * Known-good staples. MUG_11OZ matches the IDs already used as adapter
 * defaults in this codebase. The other entries are structural placeholders —
 * verify/replace the integers from your Printify account (see header).
 */
export const PRINTIFY_CATALOG: Record<PrintifyCatalogKey, PrintifyCatalogEntry> = {
  MUG_11OZ: {
    key: "MUG_11OZ",
    label: "Ceramic Mug 11oz",
    blueprintId: 68,
    printProviderId: 1,
    variantIds: [33719, 33720],
    defaultPriceCents: 1699,
    promptHint:
      "Best for funny/identity quotes and small illustrated designs; top gift staple.",
  },
  POSTER_MATTE_VERTICAL: {
    key: "POSTER_MATTE_VERTICAL",
    label: "Matte Vertical Poster",
    blueprintId: 282, // TODO: verify in your Printify account
    printProviderId: 1, // TODO: verify
    variantIds: [43130, 43133], // TODO: verify (e.g. 11x14 / 18x24)
    defaultPriceCents: 2499,
    promptHint:
      "Best for art-forward designs: botanical, vintage, typographic wall decor.",
  },
  TEE_UNISEX: {
    key: "TEE_UNISEX",
    label: "Unisex Softstyle T-Shirt",
    blueprintId: 145, // TODO: verify in your Printify account
    printProviderId: 29, // TODO: verify
    variantIds: [38158, 38159, 38160, 38161], // TODO: verify (S–XL in one color)
    defaultPriceCents: 2699,
    promptHint:
      "Best for wearable identity statements; niche pride and pet/hobby slogans.",
  },
  SWEATSHIRT_CREWNECK: {
    key: "SWEATSHIRT_CREWNECK",
    label: "Unisex Crewneck Sweatshirt",
    blueprintId: 49, // TODO: verify in your Printify account
    printProviderId: 29, // TODO: verify
    variantIds: [25376, 25377, 25378, 25379], // TODO: verify (S–XL in one color)
    defaultPriceCents: 2999,
    promptHint:
      "Best for cozy occupation/seasonal gifts (nurses week, holidays, grads).",
  },
};

export function isPrintifyCatalogKey(value: string): value is PrintifyCatalogKey {
  return (PRINTIFY_CATALOG_KEYS as readonly string[]).includes(value);
}

export function getPrintifyCatalogEntry(
  key: PrintifyCatalogKey,
): PrintifyCatalogEntry {
  return PRINTIFY_CATALOG[key];
}

/** Map Nova's product format to the closest catalog staple. */
export function catalogKeyForFormat(format: ProductFormat): PrintifyCatalogKey {
  switch (format) {
    case "poster":
    case "art_print":
      return "POSTER_MATTE_VERTICAL";
    case "tshirt":
      return "TEE_UNISEX";
    case "sweatshirt":
      return "SWEATSHIRT_CREWNECK";
    case "mug":
    case "tote_bag":
    case "phone_case":
    default:
      return "MUG_11OZ";
  }
}

/** Compact catalog menu for the Forge system prompt. */
export function formatCatalogForPrompt(): string {
  return PRINTIFY_CATALOG_KEYS.map((key) => {
    const entry = PRINTIFY_CATALOG[key];
    return `- "${key}" (${entry.label}): ${entry.promptHint}`;
  }).join("\n");
}
