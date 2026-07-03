export const PIXEL_PROMPT_VERSION = "pixel-marketing-pod-v4";

export const PIXEL_MARKETING_SYSTEM_PROMPT = `You are Pixel, the marketing agent for Octane Ajax. Generate compelling social media marketing copy for niche print-on-demand physical gifts sold on Etsy (mugs, posters, art prints, t-shirts, sweatshirts, tote bags, phone cases). Be specific, benefit-focused, and use hooks that stop scrollers.

NEVER include:
- Medical diagnosis, treatment, or cure claims
- Legal advice or litigation strategy
- Financial, investment, tax, or trading advice
- Copyrighted IP: characters, brands, celebrities, schools, sports teams, franchises
- Guaranteed results or unverifiable outcome promises
- Official government forms, bank documents, or institutional letterhead presented as real
- Digital download / printable / PDF / instant-download language — these are physical shipped products

Lean into niche identity, giftability, and emotional resonance ("made for the [audience] in your life"). Mention occasions (birthday, holiday, graduation, appreciation) where natural.

Brand voice — GotchaDayGoods: warm, celebratory, and gift-giver-first. The shop wins on occasions with built-in urgency (gotcha day, adoption day, pet memorial, retirement, appreciation weeks, milestone birthdays) — name the moment and the recipient so the copy reads as made for one specific person, not the masses. Free US shipping is baked into the price; you may cite "free shipping" as a selling point, but never invent discounts, sales, or guarantees.`;

export const PIXEL_MARKETING_JSON_INSTRUCTIONS = `Return JSON with this exact shape:
{
  "shortCaption": "string — 1-2 sentence Instagram/TikTok caption with emoji",
  "longCaption": "string — 3-4 sentence detailed caption for Pinterest/Facebook",
  "pinterestTitle": "string — SEO-optimized Pinterest pin title (max 100 chars)",
  "pinterestDescription": "string — keyword-rich Pinterest description (max 500 chars)",
  "tiktokHookIdeas": ["string", "string", "string"] — exactly 3 scroll-stopping video hook ideas,
  "hashtags": ["string", ...] — 8-12 relevant hashtags (no # prefix; the code adds it)
}`;

export const PIXEL_TIKTOK_JSON_INSTRUCTIONS = `Return JSON with this exact shape:
{
  "hook": "string — viral scroll-stopping hook (1 sentence)",
  "body": "string — short benefit-focused body (1-2 sentences)",
  "cta": "string — call to action with link-in-bio tone",
  "hashtags": ["string", ...] — exactly 3-5 relevant hashtags (no # prefix),
  "slideshowScript": [
    { "image_index": 0, "overlay_text": "string" },
    ...
  ] — 3-5 slides referencing mockup image_index (0-based) and overlay text
}`;

export const PIXEL_TIKTOK_SYSTEM_PROMPT = `${PIXEL_MARKETING_SYSTEM_PROMPT}

You also craft TikTok photo-slideshow posts: punchy hook, concise body, clear CTA, and 3-5 slides with on-image overlay text.`;

export function buildPixelMarketingUserPrompt(input: {
  listingTitle: string;
  listingDescription?: string | null;
  niche?: string | null;
  ideaTitle?: string | null;
  ideaDescription?: string | null;
  seoKeywords?: string[] | null;
  format?: string | null;
  pageCount?: number | null;
  pageTitles?: string[];
  productUrl?: string | null;
}): string {
  const lines = [
    `Product: ${input.listingTitle}`,
    input.listingDescription
      ? `Listing description: ${input.listingDescription}`
      : null,
    input.niche ? `Niche / audience: ${input.niche}` : null,
    input.ideaTitle ? `Idea title: ${input.ideaTitle}` : null,
    input.ideaDescription ? `Idea notes: ${input.ideaDescription}` : null,
    input.format ? `Format: ${input.format}` : null,
    input.pageCount != null ? `Page count: ${input.pageCount}` : null,
    input.pageTitles?.length
      ? `Page highlights: ${input.pageTitles.join(", ")}`
      : null,
    input.seoKeywords?.length
      ? `SEO keywords: ${input.seoKeywords.join(", ")}`
      : null,
    input.productUrl ? `Trackable product link: ${input.productUrl}` : null,
  ].filter(Boolean);

  const linkGuidance = input.productUrl
    ? [
        "",
        "Link rules: include the trackable product link verbatim exactly once in longCaption (e.g. \"Shop it here 👉 <link>\") and once at the end of pinterestDescription. Do NOT put the raw URL in shortCaption or tiktokHookIdeas — use a \"link in bio\" style CTA there instead.",
      ]
    : [];

  return [
    "Generate marketing copy for this print-on-demand product listing.",
    "",
    ...lines,
    ...linkGuidance,
    "",
    "Match the tone to the niche. Keep claims factual and compliant.",
  ].join("\n");
}

export function buildPixelTikTokUserPrompt(input: {
  listingTitle: string;
  listingDescription?: string | null;
  niche?: string | null;
  mockupCount?: number;
  pageTitles?: string[];
}): string {
  const lines = [
    `Product: ${input.listingTitle}`,
    input.listingDescription
      ? `Listing description: ${input.listingDescription}`
      : null,
    input.niche ? `Niche / audience: ${input.niche}` : null,
    input.mockupCount != null ? `Mockup images available: ${input.mockupCount}` : null,
    input.pageTitles?.length
      ? `Page highlights: ${input.pageTitles.join(", ")}`
      : null,
  ].filter(Boolean);

  return [
    "Generate a TikTok photo-slideshow package for this product.",
    "",
    ...lines,
    "",
    "Use image_index 0 through mockupCount-1. Keep overlay text short and punchy.",
  ].join("\n");
}
