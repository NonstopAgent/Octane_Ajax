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
  "BANDANA_CLIPON",
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
  /**
   * "transparent" = isolated design composited onto the product (apparel, mugs);
   * "opaque" = full-bleed artwork that IS the product surface (posters).
   */
  artworkBackground: "transparent" | "opaque";
  /** Composition rules injected into the image prompt for this product type. */
  artworkCompositionHint: string;
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
    // Prices bake in US shipping (shop ships free to the US — Etsy ranking boost).
    variantPrices: { 67624: 2499 },
    defaultPriceCents: 2499,
    artworkAspectRatio: "1:1",
    artworkBackground: "transparent",
    artworkCompositionHint:
      "Self-contained centered motif (illustration + short text lockup) with generous empty padding on every side — the design wraps a mug, so NOTHING important near the edges. Isolated on a transparent background: no background color, box, or scene.",
    promptHint:
      "Best for funny/identity quotes and small illustrated designs; top gift staple.",
  },
  POSTER_MATTE_VERTICAL: {
    key: "POSTER_MATTE_VERTICAL",
    label: "Matte Vertical Poster",
    blueprintId: 282, // Matte Vertical Posters
    printProviderId: 2, // Sensaria
    variantIds: [43135, 43138, 43144], // 11x14, 12x18, 18x24 Matte
    // Size-tiered; prices bake in US shipping (free-shipping listings rank higher).
    variantPrices: { 43135: 2799, 43138: 3299, 43144: 3999 },
    defaultPriceCents: 3299,
    artworkAspectRatio: "4:5", // vertical poster → portrait artwork
    artworkBackground: "opaque",
    artworkCompositionHint:
      "Full-bleed poster composition — the artwork IS the entire printed surface, edge to edge, with a deliberate background color/texture as part of the design.",
    promptHint:
      "Best for art-forward designs: botanical, vintage, typographic wall decor.",
  },
  TEE_UNISEX: {
    key: "TEE_UNISEX",
    label: "Unisex Jersey Short Sleeve Tee",
    blueprintId: 12, // Unisex Jersey Short Sleeve Tee (Bella+Canvas 3001)
    printProviderId: 29, // Monster Digital
    variantIds: [18052, 18053, 18054, 18055, 18056], // Aqua S–2XL
    // 2XL upcharge; prices bake in US shipping (free-shipping listings rank higher).
    variantPrices: { 18052: 2999, 18053: 2999, 18054: 2999, 18055: 2999, 18056: 3199 },
    defaultPriceCents: 2999,
    artworkAspectRatio: "1:1", // centered chest print
    artworkBackground: "transparent",
    artworkCompositionHint:
      "Screen-print style chest graphic that sits DIRECTLY on the fabric: bold isolated subject + text lockup with an organic silhouette. Isolated on a transparent background — absolutely NO background rectangle, square, color fill, or scene behind the design (that prints as an ugly box on the shirt).",
    promptHint:
      "Best for wearable identity statements; niche pride and pet/hobby slogans.",
  },
  SWEATSHIRT_CREWNECK: {
    key: "SWEATSHIRT_CREWNECK",
    label: "Unisex Heavy Blend Crewneck Sweatshirt",
    blueprintId: 49, // Unisex Heavy Blend Crewneck Sweatshirt (Gildan)
    printProviderId: 29, // Monster Digital
    variantIds: [25377, 25381, 25385], // S Ash, S Dark Heather, S Light Blue
    // Prices bake in US shipping (free-shipping listings rank higher).
    variantPrices: { 25377: 3999, 25381: 3999, 25385: 3999 },
    defaultPriceCents: 3699,
    artworkAspectRatio: "1:1", // centered chest print
    artworkBackground: "transparent",
    artworkCompositionHint:
      "Screen-print style chest graphic that sits DIRECTLY on the fabric: bold isolated subject + text lockup with an organic silhouette. Isolated on a transparent background — absolutely NO background rectangle, square, color fill, or scene behind the design (that prints as an ugly box on the garment).",
    promptHint:
      "Best for cozy occupation/seasonal gifts (nurses week, holidays, grads).",
  },
  BANDANA_CLIPON: {
    key: "BANDANA_CLIPON",
    label: "Clip-on Pet Bandana",
    // VERIFIED live via /api/ajax/catalog-probe?bp=1672 on 2026-07-19:
    // "Generic brand — Clip-on Pet Bandana", provider 228 (Taylor),
    // front placeholder ~1.76:1 (S 2175x1237, M 2775x1650, XL 4500x2325).
    blueprintId: 1672,
    printProviderId: 228,
    variantIds: [115222, 115223, 115225], // S, M, XL
    // Operator-approved price point ($14.99; XL carries a higher base cost).
    variantPrices: { 115222: 1499, 115223: 1499, 115225: 1799 },
    defaultPriceCents: 1499,
    artworkAspectRatio: "16:9", // wide bandana panel (~1.76:1)
    artworkBackground: "transparent",
    // Rewritten 2026-07-22 after the operator called the first wave's
    // designs "trash": dense text-heavy panels read as clipart. Boutique
    // pet-bandana bestsellers are simple: ONE charming motif + the name.
    artworkCompositionHint:
      "Boutique-quality wide bandana panel, styled like a hand-lettered pet boutique design: ONE charming focal motif (a paw print, tiny florals, or a simple heart) with a short hand-lettered phrase, arranged around a clean open banner/arc space reserved for the pet's name — the name itself is lettered per order, so do NOT render any name or date in the artwork. Generous empty space; a cohesive 2-3 color palette that reads clearly on fabric; absolutely no dense text blocks, no busy patterns, no clipart look, nothing near the edges. Isolated on a transparent background — no background color, box, or scene.",
    promptHint:
      "Best for personalized pet-name accessories; adoption day, gotcha day, and new-pet gifts.",
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
