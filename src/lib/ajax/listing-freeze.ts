/**
 * QUIET WINDOW — automated listing writes are frozen until this date.
 *
 * Context (2026-07-26): daily views collapsed 53 → 1/3/5 starting Jul 23,
 * the day the heavy edit wave landed. Every listing was touched 5-6 times in
 * 48h (prices, shipping, returns, personalization, attributes, tags, full
 * photo replacement on 23 of them) plus deactivate/reactivate cycles — and
 * Etsy re-indexes on every edit, so whole-shop churn compounded into losing
 * accumulated search placement. The fix is to stop touching listings and let
 * Etsy re-index in peace; every further automated edit restarts that clock.
 *
 * While frozen, the autopilot runs READ-ONLY against listings: audits that
 * only report, order rescue/intake/personalization (paid customers are never
 * frozen), social posting, and analytics all continue. What stops: the
 * audit+act loop, medic fixes, gallery/photo rebuilds, video attach, the
 * daily attributes writer, storefront re-sectioning, autonomous review
 * approval, and new-product publishing.
 *
 * Lift or move the window with AUTOPILOT_LISTING_FREEZE_UNTIL:
 *   ""                      → lift immediately
 *   "2026-08-03T12:00:00Z"  → extend
 * Unset uses the default below; a past date means no freeze.
 */
export const DEFAULT_LISTING_FREEZE_UNTIL = "2026-07-31T12:00:00Z";

/** The freeze end when automated listing writes are currently frozen, else null. */
export function listingWritesFrozenUntil(): Date | null {
  const raw = process.env.AUTOPILOT_LISTING_FREEZE_UNTIL;
  const value = raw === undefined ? DEFAULT_LISTING_FREEZE_UNTIL : raw.trim();
  if (!value) return null;
  const until = new Date(value);
  if (Number.isNaN(until.getTime())) return null;
  return until.getTime() > Date.now() ? until : null;
}

export function areListingWritesFrozen(): boolean {
  return listingWritesFrozenUntil() !== null;
}
