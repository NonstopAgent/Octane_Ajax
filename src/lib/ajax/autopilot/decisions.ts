/**
 * Shop Autopilot — pure decision rules.
 *
 * Given a snapshot of one live listing, decides what Ajax should do about it.
 * Policy (operator-approved): AUTO-FIX small, reversible SEO gaps; QUEUE big
 * moves (pricing, money, anything the operator voiced concerns about) as
 * strategy recommendations for one-click approval.
 */

export const ETSY_MAX_TAGS = 13;
export const ETSY_MAX_TAG_LENGTH = 20;

/** Listings younger than this get a traffic grace period (days). */
export const TRAFFIC_GRACE_DAYS = 3;
/** Below this many lifetime views after the grace period = "stalled". */
export const STALLED_VIEWS_THRESHOLD = 5;

export type ListingAuditInput = {
  etsyListingId: string;
  title: string;
  tagCount: number;
  /** US buyer shipping cost in cents; null = unknown. */
  usShippingCostCents: number | null;
  hasReturnPolicy: boolean;
  priceCents: number | null;
  /** Strategy floor for this product type (cents); null = unknown. */
  minPriceCents: number | null;
  totalViews: number;
  /** Days since the listing went live; null = unknown. */
  ageDays: number | null;
  /** Marketing content generated for it within the last 7 days. */
  hasRecentMarketing: boolean;
};

export type AutopilotAction =
  | { kind: "fill_tags"; etsyListingId: string }
  | { kind: "fix_shipping"; etsyListingId: string }
  | { kind: "queue_marketing"; etsyListingId: string }
  | {
      kind: "recommend";
      etsyListingId: string;
      category: "pricing" | "channel" | "cut" | "niche";
      title: string;
      rationale: string;
      recommendedAction: string;
      priority: number;
    };

/** Audit one live listing → ordered list of autopilot actions. */
export function auditListing(input: ListingAuditInput): AutopilotAction[] {
  const actions: AutopilotAction[] = [];
  const id = input.etsyListingId;

  // 1. Tags are the #1 discoverability lever — always keep all 13 filled.
  if (input.tagCount < ETSY_MAX_TAGS) {
    actions.push({ kind: "fill_tags", etsyListingId: id });
  }

  // 2. Etsy suppresses US listings shipping above $6; free shipping ranks best.
  if (input.usShippingCostCents != null && input.usShippingCostCents > 0) {
    actions.push({ kind: "fix_shipping", etsyListingId: id });
  }

  // 3. Return policy is an Etsy listing-quality factor — but attaching one is
  //    an operator decision (they raised concerns), so recommend, never auto.
  if (!input.hasReturnPolicy) {
    actions.push({
      kind: "recommend",
      etsyListingId: id,
      category: "channel",
      title: `Add a return policy to "${truncate(input.title, 48)}"`,
      rationale:
        "Etsy ranks listings with return policies higher and buyers trust them more. This listing has none.",
      recommendedAction:
        "Create a 30-day returns policy in Etsy → Settings → Policy settings (in practice you refund and let the buyer keep POD items — packages almost never come back), then Ajax will attach it automatically.",
      priority: 4,
    });
  }

  // 4. Pricing below the free-shipping-baked floor = margin leak. Big move → queue.
  if (
    input.priceCents != null &&
    input.minPriceCents != null &&
    input.priceCents < input.minPriceCents
  ) {
    actions.push({
      kind: "recommend",
      etsyListingId: id,
      category: "pricing",
      title: `Reprice "${truncate(input.title, 48)}" to the free-shipping floor`,
      rationale: `Listed at $${(input.priceCents / 100).toFixed(2)} but the strategy floor for this product type (US shipping baked in) is $${(input.minPriceCents / 100).toFixed(2)}.`,
      recommendedAction: `Raise the price to at least $${(input.minPriceCents / 100).toFixed(2)} in Printify (source of truth) so the free-shipping model doesn't eat the margin.`,
      priority: 4,
    });
  }

  // 5. Stalled traffic after the grace period → push marketing (free lever).
  if (
    input.ageDays != null &&
    input.ageDays >= TRAFFIC_GRACE_DAYS &&
    input.totalViews < STALLED_VIEWS_THRESHOLD &&
    !input.hasRecentMarketing
  ) {
    actions.push({ kind: "queue_marketing", etsyListingId: id });
  }

  return actions;
}

/** Etsy-safe tag list: trimmed, ≤20 chars, deduped, capped at 13. */
export function buildTagFill(
  existingTags: string[],
  candidates: string[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...existingTags, ...candidates]) {
    const tag = raw.trim().toLowerCase();
    if (!tag || tag.length > ETSY_MAX_TAG_LENGTH) continue;
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= ETSY_MAX_TAGS) break;
  }
  return out;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
