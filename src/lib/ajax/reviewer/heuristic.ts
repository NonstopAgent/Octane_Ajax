/**
 * Deterministic reviewer fallback — grades a listing against the same proven
 * rules WITHOUT an LLM, so the Review Gate always returns a verdict (even with
 * no LLM key, or when the model is slow/times out). This is what keeps autopilot
 * unstuck: every listing gets cleared one way or another.
 */
import { ETSY_PLAYBOOK, type ReviewDimensionKey } from "@/lib/ajax/reviewer/playbook";
import {
  findBlockedContentViolations,
  hasLongTailNicheLanguage,
  hasUrgencySignals,
  isGenericProductTitle,
  countWords,
} from "@/lib/ajax/product-brain/rules";

export type HeuristicReviewInput = {
  title: string;
  description?: string | null;
  price?: number | null;
  tags?: string[];
  mockupUrls?: string[];
  niche?: string | null;
  storeNiche?: string | null;
};

export type HeuristicReview = {
  subscores: Record<ReviewDimensionKey, number>;
  reasons: string[];
  fixes: string[];
  hardBlock: boolean;
};

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const PERSONALIZATION = /\b(personaliz|personalis|custom|name|monogram|portrait)\b/i;
const GIFT = /\b(gift|present|for (her|him|mom|dad|owner|lover))\b/i;

function tokens(v: string): string[] {
  return v.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length > 2);
}

export function heuristicReview(input: HeuristicReviewInput): HeuristicReview {
  const title = (input.title ?? "").trim();
  const description = (input.description ?? "").trim();
  const tags = input.tags ?? [];
  const mockups = (input.mockupUrls ?? []).filter(
    (u) => typeof u === "string" && u.startsWith("https://"),
  );
  const combined = `${title} ${description} ${tags.join(" ")}`;
  const reasons: string[] = [];
  const fixes: string[] = [];

  // Compliance (hard gate)
  const violations = findBlockedContentViolations(combined);
  const hardBlock = violations.length > 0;
  const compliance = hardBlock ? 20 : 100;
  if (hardBlock) fixes.push("Remove the flagged claim or IP reference — it can't go live.");

  // SEO
  let seo = 40;
  if (title && countWords(title) >= 4) seo += 15;
  if (title && title.length <= ETSY_PLAYBOOK.title.maxChars) seo += 10;
  if (title && !isGenericProductTitle(title)) seo += 15;
  seo += tags.length >= ETSY_PLAYBOOK.tags.count ? 10 : Math.round((tags.length / ETSY_PLAYBOOK.tags.count) * 10);
  if (tags.length > 0 && tags.every((t) => countWords(t) >= 2)) seo += 10;
  seo = clamp(seo);
  if (tags.length < ETSY_PLAYBOOK.tags.count)
    fixes.push(`Fill all ${ETSY_PLAYBOOK.tags.count} tags with multi-word long-tail phrases.`);
  if (title && isGenericProductTitle(title))
    fixes.push("Make the title specific — name the buyer and occasion.");

  // Sellability
  let sellability = 40;
  const hasPersonalization = PERSONALIZATION.test(combined);
  const hasOccasion = hasUrgencySignals(combined);
  if (hasPersonalization) sellability += 20;
  if (hasOccasion) sellability += 15;
  if (input.price != null && input.price >= 12 && input.price <= 60) sellability += 15;
  if (hasLongTailNicheLanguage(combined)) sellability += 10;
  sellability = clamp(sellability);
  if (hasPersonalization) reasons.push("Has a personalization angle (a proven top-seller lever).");
  if (hasOccasion) reasons.push("Names a built-in buying occasion.");
  if (!hasPersonalization && !hasOccasion)
    fixes.push("Add a personalization angle or name the buying occasion — the proven levers.");

  // Brand fit (to store niche, when known)
  let brand = 65;
  const storeNiche = input.storeNiche?.trim();
  if (storeNiche) {
    const nicheTokens = new Set(tokens(storeNiche));
    const overlap = tokens(combined).some((t) => nicheTokens.has(t));
    brand += overlap ? 20 : -35;
    if (!overlap) {
      reasons.push("Reads off-niche for this shop.");
      fixes.push("Bring the concept back to the shop's niche (or don't list it here).");
    }
  }
  if (hasLongTailNicheLanguage(combined)) brand += 10;
  brand = clamp(brand);

  // Quality
  let quality = 40;
  if (description && countWords(description) >= 30) quality += 25;
  else fixes.push("Expand the description: hook + who it's for + benefits + shipping.");
  if (mockups.length > 0) quality += 25;
  else fixes.push("Attach a real product mockup image.");
  if (title && !(/[A-Z]/.test(title) && title === title.toUpperCase())) quality += 10;
  quality = clamp(quality);

  return {
    subscores: { seo, sellability, brand, quality, compliance },
    reasons: reasons.slice(0, 6),
    fixes: fixes.slice(0, 6),
    hardBlock,
  };
}
