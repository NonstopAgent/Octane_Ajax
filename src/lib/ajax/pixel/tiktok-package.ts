import type { PodDetails, ProductStructure } from "@/lib/product/domain";
import type { PixelPromoInput, PixelPromoPackage } from "@/lib/ajax/pixel-promo-package";

export type TikTokSlideshowSlide = {
  image_index: number;
  overlay_text: string;
};

export type TikTokQueuePackage = {
  caption: string;
  hashtags: string[];
  mockupUrls: string[];
  slideshowScript: TikTokSlideshowSlide[];
};

export type TikTokMockupSources = {
  listingMockupUrl?: string | null;
  generationMockupPath?: string | null;
  generationPdfUrl?: string | null;
  podDetails?: PodDetails | null;
  structure?: ProductStructure | null;
};

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || value.startsWith("demo://");
}

function pushUniqueUrl(urls: string[], value: string | null | undefined): void {
  const trimmed = value?.trim();
  if (!trimmed) return;
  if (!isHttpUrl(trimmed)) return;
  if (!urls.includes(trimmed)) urls.push(trimmed);
}

function fulfillmentArtworkUrl(podDetails: PodDetails | null): string | null {
  const fulfillment = podDetails?.metadata?.fulfillment;
  if (!fulfillment || typeof fulfillment !== "object") return null;
  const artworkUrl = (fulfillment as Record<string, unknown>).artworkUrl;
  return typeof artworkUrl === "string" ? artworkUrl : null;
}

/**
 * Collect mockup / artwork URLs from listing + generation fulfillment metadata.
 */
export function extractMockupUrls(sources: TikTokMockupSources): string[] {
  const urls: string[] = [];

  pushUniqueUrl(urls, sources.listingMockupUrl);
  pushUniqueUrl(urls, sources.generationMockupPath);
  pushUniqueUrl(urls, sources.generationPdfUrl);
  pushUniqueUrl(urls, fulfillmentArtworkUrl(sources.podDetails ?? null));

  const structureMeta = sources.structure?.metadata;
  if (structureMeta && typeof structureMeta === "object") {
    for (const key of ["mockupUrl", "coverUrl", "artworkUrl"]) {
      const value = (structureMeta as Record<string, unknown>)[key];
      if (typeof value === "string") pushUniqueUrl(urls, value);
    }
  }

  if (urls.length === 0) {
    urls.push("demo://octane-ajax/tiktok/placeholder-mockup.png");
  }

  return urls.slice(0, 6);
}

function normalizeHashtagTags(tags: string[], limit = 5): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    const trimmed = tag.trim().replace(/^#+/, "");
    if (!trimmed) continue;
    const normalized = `#${trimmed}`;
    const key = normalized.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(normalized);
    }
    if (out.length >= limit) break;
  }
  return out;
}

function promoContext(input: PixelPromoInput) {
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
    "custom gift";
  const pageTitles =
    structure?.pages
      ?.map((p) => p.title?.trim())
      .filter((t): t is string => Boolean(t))
      .slice(0, 4) ?? [];

  return { displayTitle, niche, format, pageTitles, podDetails };
}

function buildSlideshowScript(
  hooks: string[],
  pageTitles: string[],
  displayTitle: string,
  mockupCount: number,
): TikTokSlideshowSlide[] {
  const slideTexts = [
    hooks[0] ?? `POV: you found ${displayTitle}`,
    pageTitles[0] ? `Inside: ${pageTitles[0]}` : "Here's what's inside 👀",
    pageTitles[1] ? `Plus: ${pageTitles[1]}` : "Original art — made to order, shipped to you",
    hooks[1] ?? "Save this before your next scroll session",
    "Link in bio — grab yours (demo storefront)",
  ].slice(0, 5);

  return slideTexts.map((overlay_text, index) => ({
    image_index: Math.min(index, Math.max(mockupCount - 1, 0)),
    overlay_text,
  }));
}

/**
 * Deterministic TikTok slideshow package from Pixel promo output.
 */
export function buildTikTokQueuePackage(
  input: PixelPromoInput,
  promo: PixelPromoPackage,
  mockupSources: TikTokMockupSources,
): TikTokQueuePackage {
  const { displayTitle, niche, format, pageTitles, podDetails } =
    promoContext(input);
  const mockupUrls = extractMockupUrls({
    ...mockupSources,
    podDetails,
    structure: input.structure ?? null,
  });
  const hooks = promo.metadata.tiktokHookIdeas;
  const hook = hooks[0] ?? `POV: you finally fixed ${niche ?? "your routine"}.`;
  const body = podDetails
    ? `${displayTitle} — ${format} made to order.`
    : pageTitles.length > 0
      ? `${displayTitle} — ${pageTitles.slice(0, 2).join(" + ")}.`
      : `${displayTitle} — structured ${format}.`;
  const cta = "Tap link in bio for the demo drop ✨";
  const caption = [hook, body, cta].join("\n\n");
  const hashtags = normalizeHashtagTags(promo.hashtags, 5);

  return {
    caption,
    hashtags,
    mockupUrls,
    slideshowScript: buildSlideshowScript(
      hooks,
      pageTitles,
      displayTitle,
      mockupUrls.length,
    ),
  };
}

export type TikTokSlideshowLlmOutput = {
  hook: string;
  body: string;
  cta: string;
  hashtags: string[];
  slideshowScript: TikTokSlideshowSlide[];
};

export function mapLlmToTikTokQueuePackage(
  input: PixelPromoInput,
  promo: PixelPromoPackage,
  mockupSources: TikTokMockupSources,
  llm: TikTokSlideshowLlmOutput,
): TikTokQueuePackage {
  const mockupUrls = extractMockupUrls({
    ...mockupSources,
    podDetails: input.podDetails ?? null,
    structure: input.structure ?? null,
  });

  return {
    caption: [llm.hook.trim(), llm.body.trim(), llm.cta.trim()].join("\n\n"),
    hashtags: normalizeHashtagTags(llm.hashtags, 5),
    mockupUrls,
    slideshowScript: llm.slideshowScript.slice(0, 5).map((slide, index) => ({
      image_index: Math.min(
        slide.image_index,
        Math.max(mockupUrls.length - 1, 0),
      ),
      overlay_text: slide.overlay_text.trim() || `Slide ${index + 1}`,
    })),
  };
}
