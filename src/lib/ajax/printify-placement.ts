/**
 * Print-area placement math + catalog dimension lookup.
 *
 * ROOT CAUSE of the 2026-07 defect wave: products were created with
 * `scale: 1` on every blueprint. Scale is a fraction of PRINT-AREA WIDTH, so
 * square art on a mug wrap (~2.36:1) rendered at full wrap width — top/bottom
 * cropped, text sheared at the wrap edges, and the mockup "front" camera
 * staring at the middle of a wrap-spanning graphic. The fix everywhere:
 * scale so the art FITS INSIDE the print area (contain, with a margin),
 * centered, unrotated — and full-bleed only when the art's aspect actually
 * matches the print area's.
 */

const PRINTIFY_API_BASE = "https://api.printify.com/v1";

/** Fraction of the print area the art may span in its constrained dimension. */
export const PLACEMENT_MARGIN = 0.85;

/** Aspect ratios closer than this are treated as matching → full bleed. */
const FULL_BLEED_TOLERANCE = 0.08;

export type Placement = { x: number; y: number; scale: number; angle: number };

/**
 * Printify `scale` = imageWidth / printAreaWidth. Height fraction works out
 * to scale * areaAspect / imageAspect (aspect = w/h). Contain-fit:
 *   width-constrained:  scale <= margin
 *   height-constrained: scale <= margin * imageAspect / areaAspect
 * If the aspects match within tolerance, go full bleed (scale 1).
 */
export function fitScale(
  imageAspect: number,
  areaAspect: number,
  margin: number = PLACEMENT_MARGIN,
): number {
  if (
    !Number.isFinite(imageAspect) ||
    !Number.isFinite(areaAspect) ||
    imageAspect <= 0 ||
    areaAspect <= 0
  ) {
    return margin;
  }
  const ratio = imageAspect / areaAspect;
  if (Math.abs(ratio - 1) <= FULL_BLEED_TOLERANCE) return 1;
  const scale = margin * Math.min(1, ratio);
  return Math.min(1, Math.max(0.05, Number(scale.toFixed(4))));
}

/** Centered, unrotated, contain-fit placement. */
export function centeredPlacement(
  imageAspect: number,
  areaAspect: number,
  margin: number = PLACEMENT_MARGIN,
): Placement {
  return { x: 0.5, y: 0.5, scale: fitScale(imageAspect, areaAspect, margin), angle: 0 };
}

export type PlaceholderDims = { width: number; height: number };

/** Known print-area sizes when the catalog lookup fails (px, from Printify
 * catalog docs). 503 = 11oz mug full wrap. */
const AREA_FALLBACKS: Record<string, PlaceholderDims> = {
  "503:front": { width: 2475, height: 1050 },
};

const dimsCache = new Map<string, PlaceholderDims>();

/**
 * Print-area pixel dimensions for a blueprint/provider/variant placeholder
 * from the Printify catalog (the product JSON itself never includes them).
 */
export async function getPlaceholderDims(params: {
  blueprintId: number;
  printProviderId: number;
  variantId?: number;
  position?: string;
  apiToken: string;
  fetchImpl?: typeof fetch;
}): Promise<PlaceholderDims | null> {
  const position = params.position ?? "front";
  const cacheKey = `${params.blueprintId}:${params.printProviderId}:${params.variantId ?? "any"}:${position}`;
  const cached = dimsCache.get(cacheKey);
  if (cached) return cached;

  try {
    const fetchImpl = params.fetchImpl ?? fetch;
    const res = await fetchImpl(
      `${PRINTIFY_API_BASE}/catalog/blueprints/${params.blueprintId}/print_providers/${params.printProviderId}/variants.json`,
      { headers: { Authorization: `Bearer ${params.apiToken}` } },
    );
    if (!res.ok) throw new Error(`catalog variants ${res.status}`);
    const payload = (await res.json()) as {
      variants?: {
        id?: number;
        placeholders?: { position?: string; width?: number; height?: number }[];
      }[];
    };
    const variants = payload.variants ?? [];
    const variant =
      (params.variantId != null
        ? variants.find((v) => v.id === params.variantId)
        : undefined) ?? variants[0];
    const ph =
      variant?.placeholders?.find((p) => p.position === position) ??
      variant?.placeholders?.[0];
    if (ph?.width && ph?.height) {
      const dims = { width: ph.width, height: ph.height };
      dimsCache.set(cacheKey, dims);
      return dims;
    }
  } catch {
    // fall through to the static fallback
  }

  const fallback =
    AREA_FALLBACKS[`${params.blueprintId}:${position}`] ??
    AREA_FALLBACKS[`${params.blueprintId}:front`] ??
    null;
  if (fallback) dimsCache.set(cacheKey, fallback);
  return fallback;
}
