/**
 * Store QA — a deterministic, whole-shop professionalism sweep. Where the Review
 * Gate grades one listing with an LLM, this scans every listing fast and free,
 * flagging what looks amateur or incomplete and returning a prioritized fix list.
 * Grounded in the same proven rules (ETSY_PLAYBOOK + product-brain rules).
 */
import { ETSY_PLAYBOOK } from "@/lib/ajax/reviewer/playbook";
import {
  findBlockedContentViolations,
  isGenericProductTitle,
  hasLongTailNicheLanguage,
  hasUrgencySignals,
  countWords,
  titleStyleIssues,
} from "@/lib/ajax/product-brain/rules";

export type QaSeverity = "critical" | "warning" | "info";

export type QaIssue = {
  severity: QaSeverity;
  code: string;
  message: string;
  fix: string;
};

export type QaListingInput = {
  id: string;
  title: string | null;
  description: string | null;
  price: number | null;
  mockupUrl: string | null;
  status?: string | null;
  tags?: string[];
};

export type ListingAudit = {
  listingId: string;
  title: string;
  score: number;
  issues: QaIssue[];
};

export type StoreQaReport = {
  overallScore: number;
  listingCount: number;
  counts: { critical: number; warning: number; info: number };
  listings: ListingAudit[];
  storeFlags: QaIssue[];
  topFixes: string[];
};

const PENALTY: Record<QaSeverity, number> = {
  critical: 25,
  warning: 10,
  info: 3,
};
const PERSONALIZATION =
  /\b(personaliz|personalis|custom|name|monogram|portrait)\b/i;

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** Audit one listing against the proven professionalism rules. */
export function auditListing(input: QaListingInput): ListingAudit {
  const issues: QaIssue[] = [];
  const title = (input.title ?? "").trim();
  const description = (input.description ?? "").trim();
  const combined = `${title} ${description} ${(input.tags ?? []).join(" ")}`;

  if (!title) {
    issues.push({
      severity: "critical",
      code: "title_missing",
      message: "Listing has no title.",
      fix: "Add a front-loaded, buyer-focused title (specific buyer + occasion).",
    });
  } else {
    if (title.length > ETSY_PLAYBOOK.title.maxChars)
      issues.push({
        severity: "warning",
        code: "title_too_long",
        message: `Title is ${title.length} chars (over ${ETSY_PLAYBOOK.title.maxChars}).`,
        fix: `Trim to ≤${ETSY_PLAYBOOK.title.maxChars}; keep the strongest phrase in the first ~40 chars.`,
      });
    if (countWords(title) < 4)
      issues.push({
        severity: "warning",
        code: "title_thin",
        message: "Title is short/thin on keywords.",
        fix: "Add the specific buyer, breed, and occasion so it's findable.",
      });
    if (isGenericProductTitle(title))
      issues.push({
        severity: "warning",
        code: "title_generic",
        message: "Title reads generic (anyone could make it).",
        fix: "Name the specific pet-parent buyer and the moment it's for.",
      });
    if (/[A-Z]/.test(title) && title === title.toUpperCase())
      issues.push({
        severity: "warning",
        code: "title_all_caps",
        message: "Title is ALL CAPS (reads spammy).",
        fix: "Use natural capitalization.",
      });
    // Etsy's own title checker rules (search-visibility banner): >14 words
    // or heavy keyword repetition gets the listing re-flagged until fixed.
    for (const style of titleStyleIssues(title))
      issues.push({
        severity: "warning",
        code: "title_style",
        message: style,
        fix: "Rewrite ≤14 words with each significant word said once; move variations into tags.",
      });
  }

  if (!description) {
    issues.push({
      severity: "critical",
      code: "description_missing",
      message: "Listing has no description.",
      fix: "Open with a hook + who it's for, then benefits, then care/shipping.",
    });
  } else if (countWords(description) < 30) {
    issues.push({
      severity: "warning",
      code: "description_thin",
      message: "Description is very short.",
      fix: "Expand to a hook, 3–5 benefit lines, and a shipping/quality note.",
    });
  }

  if (input.price == null || input.price <= 0) {
    issues.push({
      severity: "critical",
      code: "price_missing",
      message: "Listing has no valid price.",
      fix: "Set a price in the proven band for the format.",
    });
  } else if (input.price < 12 || input.price > 60) {
    issues.push({
      severity: "warning",
      code: "price_out_of_band",
      message: `Price $${input.price.toFixed(2)} is outside the proven $12–$60 range.`,
      fix: "Move toward the proven band; new shops price to the lower end.",
    });
  }

  const mock = (input.mockupUrl ?? "").trim();
  if (!mock || mock.startsWith("demo://") || !mock.startsWith("https://")) {
    issues.push({
      severity: "critical",
      code: "mockup_missing",
      message: "No real product image (mockup missing or a demo placeholder).",
      fix: "Attach a real https mockup — the hero image drives click-through.",
    });
  }

  if (input.tags) {
    if (input.tags.length !== ETSY_PLAYBOOK.tags.count)
      issues.push({
        severity: "warning",
        code: "tags_count",
        message: `Uses ${input.tags.length} of ${ETSY_PLAYBOOK.tags.count} tags.`,
        fix: `Fill all ${ETSY_PLAYBOOK.tags.count} tags with multi-word long-tail phrases.`,
      });
    if (input.tags.some((t) => countWords(t) < 2))
      issues.push({
        severity: "info",
        code: "tags_single_word",
        message: "Some tags are single broad words.",
        fix: "Make every tag a multi-word buyer phrase (e.g. 'rescue dog mom mug').",
      });
  }

  if (findBlockedContentViolations(combined).length > 0) {
    issues.push({
      severity: "critical",
      code: "compliance_risk",
      message: "Copy contains blocked/risky content (IP, medical, guarantees).",
      fix: "Remove the flagged claim or IP reference before it goes live.",
    });
  }

  if (
    title &&
    !PERSONALIZATION.test(combined) &&
    !hasUrgencySignals(combined) &&
    !hasLongTailNicheLanguage(combined)
  ) {
    issues.push({
      severity: "info",
      code: "no_proven_signal",
      message: "No personalization, occasion, or long-tail niche signal.",
      fix: "Add a personalization angle or name the buying occasion — the proven levers.",
    });
  }

  const score = clamp(
    100 - issues.reduce((sum, i) => sum + PENALTY[i.severity], 0),
  );
  return { listingId: input.id, title: title || "(untitled)", score, issues };
}

function normalizeTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Audit the whole store: per-listing + store-level flags + prioritized fixes. */
export function auditStore(listings: QaListingInput[]): StoreQaReport {
  const audits = listings.map(auditListing);
  const counts = { critical: 0, warning: 0, info: 0 };
  for (const a of audits) for (const i of a.issues) counts[i.severity] += 1;

  const overallScore = audits.length
    ? Math.round(audits.reduce((s, a) => s + a.score, 0) / audits.length)
    : 100;

  const storeFlags: QaIssue[] = [];

  // Duplicate / near-duplicate titles across the shop.
  const seen = new Map<string, number>();
  for (const a of audits) {
    const key = normalizeTitle(a.title);
    if (key && key !== "untitled") seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const dupes = [...seen.values()].filter((n) => n > 1).length;
  if (dupes > 0)
    storeFlags.push({
      severity: "warning",
      code: "duplicate_titles",
      message: `${dupes} duplicate/near-duplicate listing title${
        dupes === 1 ? "" : "s"
      } in the shop.`,
      fix: "Differentiate titles — duplicates split ranking and look copy-pasted.",
    });

  // Share of listings missing a real image.
  const noImage = audits.filter((a) =>
    a.issues.some((i) => i.code === "mockup_missing"),
  ).length;
  if (audits.length > 0 && noImage / audits.length >= 0.34)
    storeFlags.push({
      severity: "critical",
      code: "store_images",
      message: `${noImage} of ${audits.length} listings have no real product image.`,
      fix: "Every live listing needs a real hero mockup before it's shopper-ready.",
    });

  // Prioritized, deduped fix list (criticals first).
  const order: QaSeverity[] = ["critical", "warning", "info"];
  const fixSet = new Set<string>();
  const topFixes: string[] = [];
  for (const sev of order) {
    for (const a of audits)
      for (const i of a.issues)
        if (i.severity === sev && !fixSet.has(i.fix)) {
          fixSet.add(i.fix);
          topFixes.push(i.fix);
        }
    for (const f of storeFlags)
      if (f.severity === sev && !fixSet.has(f.fix)) {
        fixSet.add(f.fix);
        topFixes.push(f.fix);
      }
  }

  return {
    overallScore,
    listingCount: audits.length,
    counts,
    listings: audits,
    storeFlags,
    topFixes: topFixes.slice(0, 8),
  };
}
