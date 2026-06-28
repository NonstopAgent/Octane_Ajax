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
  /** Retail price (USD cents) per variant id — larger sizes priced higher. */
  variantPrices: Record<number, number>;
  /** Default retail price in cents when Forge's price is missing/invalid. */
  defaultPriceCents: number;
  /** Artwork aspect ratio that fills this product's print area (avoids cropping). */
  artworkAspectRatio: "1:1" | "4:5" | "16:9";
  /** Hint for Forge about when to pick this product. */
  promptHint: string;
};

/**
 * VERIFIED against the live Printify catalog on 2026-06-12 via
 * /api/ajax/debug/printify-catalog (run with this account's API token).
 * All blueprint/provider/variant combos below are valid by construction.
 */
export const PRINTIFY_CATALOG: Record<PrintifyCatalogKey, PrintifyCatalogEntry> = {
  MUG_11OZ: {
    key: "MUG_11OZ",
    label: "White Ceramic Mug 11oz",
    blueprintId: 503, // White Ceramic Mug, 11oz
    printProviderId: 48, // Colorway
    variantIds: [67624], // 11oz
    variantPrices: { 67624: 1799 },
    defaultPriceCents: 1699,
    artworkAspectRatio: "1:1",
    promptHint:
      "Best for funny/identity quotes and small illustrated designs; top gift staple.",
  },
  POSTER_MATTE_VERTICAL: {
    key: "POSTER_MATTE_VERTICAL",
    label: "Matte Vertical Poster",
    blueprintId: 282, // Matte Vertical Posters
    printProviderId: 2, // Sensaria
    variantIds: [43135, 43138, 43144], // 11x14, 12x18, 18x24 Matte
    variantPrices: { 43135: 1899, 43138: 2499, 43144: 3499 }, // size-tiered
    defaultPriceCents: 2499,
    artworkAspectRatio: "4:5", // vertical poster → portrait artwork
    promptHint:
      "Best for art-forward designs: botanical, vintage, typographic wall decor.",
  },
  TEE_UNISEX: {
    key: "TEE_UNISEX",
    label: "Unisex Jersey Short Sleeve Tee",
    blueprintId: 12, // Unisex Jersey Short Sleeve Tee (Bella+Canvas 3001)
    printProviderId: 29, // Monster Digital
    variantIds: [18052, 18053, 18054, 18055, 18056], // Aqua S–2XL
    variantPrices: { 18052: 2699, 18053: 2699, 18054: 2699, 18055: 2699, 18056: 2899 }, // 2XL upcharge
    defaultPriceCents: 2699,
    artworkAspectRatio: "1:1", // centered chest print
    promptHint:
      "Best for wearable identity statements; niche pride and pet/hobby slogans.",
  },
  SWEATSHIRT_CREWNECK: {
    key: "SWEATSHIRT_CREWNECK",
    label: "Unisex Heavy Blend Crewneck Sweatshirt",
    blueprintId: 49, // Unisex Heavy Blend Crewneck Sweatshirt (Gildan)
    printProviderId: 29, // Monster Digital
    variantIds: [25377, 25381, 25385], // S Ash, S Dark Heather, S Light Blue
    variantPrices: { 25377: 3499, 25381: 3499, 25385: 3499 },
    defaultPriceCents: 2999,
    artworkAspectRatio: "1:1", // centered chest print
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
