/**
 * Etsy Share & Save trackable links.
 *
 * The shop is enrolled in Etsy's Share & Save program: orders that arrive
 * through the shop's unique share domain earn 0% transaction fees (intro
 * window) and an ongoing discount on the Etsy bill. Every URL the app shares
 * publicly (social captions, promo packages, dashboards) should therefore use
 * the share domain instead of a plain www.etsy.com link.
 *
 * Configure via ETSY_SHARE_SAVE_URL; defaults to the operator's share domain.
 */

const DEFAULT_SHARE_SAVE_URL = "https://octaneajax.etsy.com";

/** Base trackable shop URL (no trailing slash). */
export function getShareSaveBaseUrl(): string {
  const raw = process.env.ETSY_SHARE_SAVE_URL?.trim() || DEFAULT_SHARE_SAVE_URL;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withScheme.replace(/\/+$/, "");
}

/**
 * Extracts a numeric Etsy listing id from a raw id or any Etsy listing URL
 * (e.g. "https://www.etsy.com/listing/4529408131/slug" → "4529408131").
 */
export function extractEtsyListingId(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (/^\d{6,}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/\/listing\/(\d{6,})(?:[/?#]|$)/i);
  return match ? match[1] : null;
}

export type ShareSaveUrlInput = {
  /** Etsy listing id (numeric string) when known. */
  etsyListingId?: string | null;
  /** Any stored listing URL to derive the id from as a fallback. */
  listingUrl?: string | null;
};

/**
 * Best trackable URL for a product: the Share & Save listing link when the
 * Etsy listing id is known, otherwise the Share & Save shop link.
 */
export function buildShareSaveUrl(input?: ShareSaveUrlInput): string {
  const base = getShareSaveBaseUrl();
  const id =
    extractEtsyListingId(input?.etsyListingId) ??
    extractEtsyListingId(input?.listingUrl);
  return id ? `${base}/listing/${id}` : base;
}
