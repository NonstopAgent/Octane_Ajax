import type { ProductStructure } from "@/lib/product/domain";
import type {
  Json,
  TablesUpdate,
} from "@/lib/supabase/database.types";

/**
 * Rich marketing fields for Pixel (deterministic templates today; LLM-ready shape).
 * Persisted on `content_jobs.metadata` when that column exists; otherwise logged on events.
 */
export type PixelPromoMetadata = {
  shortCaption: string;
  longCaption: string;
  pinterestTitle: string;
  pinterestDescription: string;
  tiktokHookIdeas: string[];
  hashtags: string[];
  /** Traceability for future LLM prompts — not for publishing as-is. */
  source: {
    listingTitle: string;
    listingDescription: string | null;
    niche: string | null;
    ideaTitle: string | null;
    format: string | null;
    pageCount: number | null;
    pageTitles: string[];
    seoKeywords: string[];
  };
};

export type PixelPromoPackage = {
  /** Primary caption stored on `content_jobs.caption` (short form). */
  caption: string;
  metadata: PixelPromoMetadata;
  hashtags: string[];
  assetUrl: string;
  scheduledFor: string;
};

/** Set false only if `20260518140000_content_jobs_metadata.sql` is not applied yet. */
export const CONTENT_JOBS_HAS_METADATA_COLUMN = true;

export type PixelPromoInput = {
  jobId: string;
  listingTitle: string;
  listingDescription?: string | null;
  niche?: string | null;
  ideaTitle?: string | null;
  ideaDescription?: string | null;
  seoKeywords?: string[] | null;
  structure?: ProductStructure | null;
};

const DEMO_HASHTAGS = [
  "#OctaneAjax",
  "#DemoShop",
  "#SmallBusiness",
  "#PrintablePlanner",
  "#DigitalDownload",
] as const;

function slugHashtag(value: string): string | null {
  const slug = value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "")
    .slice(0, 40);
  return slug.length >= 3 ? `#${slug}` : null;
}

function uniqueHashtags(tags: string[], limit = 12): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    const normalized = tag.startsWith("#") ? tag : `#${tag}`;
    const key = normalized.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(normalized);
    }
    if (out.length >= limit) break;
  }
  return out;
}

function parseStructure(raw: unknown): ProductStructure | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as ProductStructure;
  if (!Array.isArray(s.pages)) return null;
  return s;
}

function extractPageTitles(structure: ProductStructure | null): string[] {
  if (!structure?.pages?.length) return [];
  return structure.pages
    .map((p) => p.title?.trim())
    .filter((t): t is string => Boolean(t))
    .slice(0, 6);
}

function buildHashtags(input: PixelPromoInput): string[] {
  const fromNiche = input.niche ? slugHashtag(input.niche) : null;
  const fromFormat =
    input.structure?.format ? slugHashtag(input.structure.format) : null;
  const fromSeo = (input.seoKeywords ?? [])
    .map((kw) => slugHashtag(kw))
    .filter((t): t is string => Boolean(t));

  return uniqueHashtags([
    ...fromSeo,
    ...(fromNiche ? [fromNiche] : []),
    ...(fromFormat ? [fromFormat] : []),
    ...DEMO_HASHTAGS,
  ]);
}

function benefitLines(pageTitles: string[], format: string | null): string[] {
  if (pageTitles.length >= 2) {
    return pageTitles.slice(0, 4).map((title) => `• ${title} — ready to print and use`);
  }
  const label = format ?? "printable";
  return [
    `• Structured ${label} you can use immediately`,
    "• Clear sections — no blank-page guesswork",
    "• Built for a specific audience, not generic filler",
  ];
}

/**
 * Deterministic promo copy from listing + optional product generation structure.
 */
export function buildPixelPromoPackage(input: PixelPromoInput): PixelPromoPackage {
  const structure = input.structure ?? null;
  const displayTitle =
    input.listingTitle.trim() ||
    input.ideaTitle?.trim() ||
    "Your new printable";
  const niche = input.niche?.trim() || null;
  const format = structure?.format?.trim() || null;
  const pageCount = structure?.pageCount ?? structure?.pages?.length ?? null;
  const pageTitles = extractPageTitles(structure);
  const hashtags = buildHashtags({ ...input, structure });
  const hashtagLine = hashtags.join(" ");

  const audience = niche ? `${niche} fans` : "busy planners";
  const formatLabel = format ?? "printable download";

  const shortCaption = [
    `✨ ${displayTitle} — ${formatLabel} for ${audience}.`,
    pageCount ? `${pageCount} pages, instant download.` : "Instant download.",
    hashtagLine,
  ].join("\n");

  const benefits = benefitLines(pageTitles, format);
  const longCaption = [
    `${displayTitle}`,
    "",
    input.listingDescription?.trim() ||
      input.ideaDescription?.trim() ||
      `A focused ${formatLabel} built to solve one real problem — not generic inspiration.`,
    "",
    "What's inside:",
    ...benefits,
    "",
    "Tap through for the demo slideshow — packaged by Pixel.",
    "",
    hashtagLine,
  ].join("\n");

  const pinterestTitle = (() => {
    const base = niche
      ? `${displayTitle} | ${niche} ${formatLabel}`
      : `${displayTitle} | ${formatLabel}`;
    return base.length > 100 ? `${base.slice(0, 97)}...` : base;
  })();

  const keywordSnippet = (input.seoKeywords ?? []).slice(0, 5).join(", ");
  const pinterestDescription = [
    `${displayTitle} — a ${formatLabel}${niche ? ` for ${niche}` : ""}.`,
    pageCount ? `${pageCount} printable pages.` : "Printable pages included.",
    pageTitles.length
      ? `Includes: ${pageTitles.slice(0, 3).join(", ")}.`
      : "Structured sections ready to print.",
    keywordSnippet ? `Keywords: ${keywordSnippet}.` : "",
    "Instant digital download (demo storefront).",
  ]
    .filter(Boolean)
    .join(" ");

  const problem = niche ?? "your routine";
  const tiktokHookIdeas = [
    `POV: you finally fixed ${problem} with one ${formatLabel}.`,
    `Stop scrolling if you need ${displayTitle} this week.`,
    `I printed this in 2 minutes — here's what's inside 👀`,
    `The ${pageCount ?? "multi"}-page version nobody told you about.`,
    `Demo drop: ${displayTitle} (link in bio).`,
  ];

  const scheduledFor = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const assetUrl = `demo://octane-ajax/promo/${input.jobId}/slideshow.mp4`;

  const metadata: PixelPromoMetadata = {
    shortCaption,
    longCaption,
    pinterestTitle,
    pinterestDescription,
    tiktokHookIdeas,
    hashtags,
    source: {
      listingTitle: displayTitle,
      listingDescription: input.listingDescription?.trim() || null,
      niche,
      ideaTitle: input.ideaTitle?.trim() || null,
      format,
      pageCount,
      pageTitles,
      seoKeywords: input.seoKeywords ?? [],
    },
  };

  return {
    caption: shortCaption,
    metadata,
    hashtags,
    assetUrl,
    scheduledFor,
  };
}

/** Update payload for scheduling a content job after Pixel runs. */
export function buildContentJobScheduleUpdate(
  promo: PixelPromoPackage,
): TablesUpdate<"content_jobs"> {
  const base: TablesUpdate<"content_jobs"> = {
    status: "scheduled",
    caption: promo.caption,
    asset_url: promo.assetUrl,
    scheduled_for: promo.scheduledFor,
  };

  if (CONTENT_JOBS_HAS_METADATA_COLUMN) {
    return {
      ...base,
      metadata: promo.metadata as unknown as Json,
    } as TablesUpdate<"content_jobs">;
  }

  return base;
}

export { parseStructure };
