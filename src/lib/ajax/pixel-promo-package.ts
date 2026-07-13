import type { PodDetails, ProductStructure } from "@/lib/product/domain";
import { buildVideoSpec, type VideoSpec } from "@/lib/ajax/pixel/video-spec";
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
  /** Content pillar this post was written for (learning-loop dimension). */
  pillar?: string | null;
  /** Playbook-grounded 9:16 short-form video plan (hook, timed shots, audio, CTA). */
  videoSpec?: VideoSpec;
  /** Trackable Share & Save product URL to include when posting. */
  productUrl?: string | null;
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
  podDetails?: PodDetails | null;
  /** Trackable Share & Save URL for this product (listing link or shop link). */
  productUrl?: string | null;
  /** Public https mockup image of the listing — becomes the post's media. */
  mockupUrl?: string | null;
  /** Strategist: assigned content pillar (product | relatable | trend). */
  contentPillar?: string | null;
  /** Strategist: today's live trend brief (omitted when unavailable). */
  trendBrief?: string | null;
  /** Learning loop: measured engagement summary of recent posts. */
  performanceNotes?: string | null;
};

const DEMO_HASHTAGS = [
  "#GotchaDayGoods",
  "#EtsyFinds",
  "#GiftIdeas",
  "#MadeToOrder",
  "#SmallBusiness",
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

function parsePodDetails(raw: unknown): PodDetails | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as PodDetails;
  if (typeof s.blueprintId !== "number") return null;
  return s;
}

function parseStructure(raw: unknown): ProductStructure | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.blueprintId === "number") return null;
  const s = raw as ProductStructure;
  if (!Array.isArray(s.pages)) return null;
  return s;
}

function parseGenerationPayload(raw: unknown): {
  structure: ProductStructure | null;
  podDetails: PodDetails | null;
} {
  const podDetails = parsePodDetails(raw);
  if (podDetails) {
    return { structure: null, podDetails };
  }
  return { structure: parseStructure(raw), podDetails: null };
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
    input.podDetails?.aestheticStyle
      ? slugHashtag(input.podDetails.aestheticStyle)
      : input.structure?.format
        ? slugHashtag(input.structure.format)
        : null;
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
  const podDetails = input.podDetails ?? null;
  const displayTitle =
    input.listingTitle.trim() ||
    input.ideaTitle?.trim() ||
    "Your new product";
  const niche = input.niche?.trim() || null;
  const format =
    podDetails?.aestheticStyle?.trim() ||
    structure?.format?.trim() ||
    null;
  const pageCount = structure?.pageCount ?? structure?.pages?.length ?? null;
  const pageTitles = extractPageTitles(structure);
  const hashtags = buildHashtags({ ...input, structure, podDetails });
  const hashtagLine = hashtags.join(" ");

  const audience = niche ? `${niche} fans` : "gift shoppers";
  const formatLabel = podDetails ? "print-on-demand gift" : format ?? "printable download";
  const productUrl = input.productUrl?.trim() || null;

  const shortCaption = [
    `✨ ${displayTitle} — ${formatLabel} for ${audience}.`,
    podDetails ? "Made to order, ships fast. 🔗 Link in bio!" : pageCount ? `${pageCount} pages, instant download.` : "Instant download.",
    hashtagLine,
  ].join("\n");

  const benefits = podDetails
    ? [
        `• Original ${podDetails.aestheticStyle} artwork`,
        "• Print-on-demand — no inventory needed",
        "• Ships via Printify fulfillment",
      ]
    : benefitLines(pageTitles, format);
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
    productUrl
      ? `Shop it here 👉 ${productUrl}`
      : "Tap through for the demo slideshow — packaged by Pixel.",
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
    podDetails
      ? "Original artwork, made to order and shipped to your door."
      : pageCount
        ? `${pageCount} printable pages.`
        : "Printable pages included.",
    podDetails
      ? ""
      : pageTitles.length
        ? `Includes: ${pageTitles.slice(0, 3).join(", ")}.`
        : "Structured sections ready to print.",
    keywordSnippet ? `Keywords: ${keywordSnippet}.` : "",
    productUrl
      ? `Shop: ${productUrl}`
      : podDetails
        ? "Available on Etsy."
        : "Instant digital download (demo storefront).",
  ]
    .filter(Boolean)
    .join(" ");

  const problem = niche ?? "your routine";
  const tiktokHookIdeas = podDetails
    ? [
        `POV: you found the perfect ${problem} gift.`,
        `This ${formatLabel} is going viral in ${problem} — here's why.`,
        `Made-to-order drop: ${displayTitle} 👀`,
        `Stop scrolling if you need a ${niche ?? "unique"} gift this week.`,
        `Demo drop: ${displayTitle} (link in bio).`,
      ]
    : [
        `POV: you finally fixed ${problem} with one ${formatLabel}.`,
        `Stop scrolling if you need ${displayTitle} this week.`,
        `I printed this in 2 minutes — here's what's inside 👀`,
        `The ${pageCount ?? "multi"}-page version nobody told you about.`,
        `Demo drop: ${displayTitle} (link in bio).`,
      ];

  const scheduledFor = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  // Real listing mockup when available — the auto-poster only publishes jobs
  // whose asset is a live https image. The demo:// placeholder is kept ONLY
  // as a last resort for legacy demo flows without a listing image.
  const assetUrl =
    input.mockupUrl?.trim().startsWith("https://") === true
      ? input.mockupUrl.trim()
      : `demo://octane-ajax/promo/${input.jobId}/slideshow.mp4`;

  const mockupCount = podDetails ? 3 : Math.max(1, pageTitles.length);
  const videoSpec = buildVideoSpec({
    productTitle: displayTitle,
    niche,
    format,
    mockupCount,
    productUrl,
    hashtags,
  });

  const metadata: PixelPromoMetadata = {
    shortCaption,
    longCaption,
    pinterestTitle,
    pinterestDescription,
    tiktokHookIdeas,
    hashtags,
    pillar: input.contentPillar ?? null,
    videoSpec,
    productUrl,
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

export { parseStructure, parseGenerationPayload };
