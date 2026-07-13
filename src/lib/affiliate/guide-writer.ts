import "server-only";

/**
 * Guide writer — Sage, the affiliate content engine. Writes one pet-niche
 * gift guide a day: genuinely useful listicle content that features
 * GotchaDayGoods products alongside affiliate picks (Amazon search links,
 * decorated with the Associates tag once configured). Every product link
 * routes through /go/{slug} for click tracking.
 *
 * Content honesty: guides carry an affiliate disclosure line, and product
 * copy stays factual — same compliance rules as the shop.
 */
import { z } from "zod";
import { completeJson } from "@/lib/llm/json";
import { fetchTrendBrief } from "@/lib/ajax/pixel/trend-research";
import { ensureLink, slugify } from "@/lib/affiliate/links";
import type { Json } from "@/lib/supabase/database.types";
import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";

const GuideSchema = z.object({
  title: z.string().min(20).max(90),
  description: z.string().min(60).max(180),
  intro: z.string().min(120),
  sections: z
    .array(
      z.object({
        heading: z.string().min(6).max(90),
        body: z.string().min(80),
        /** Index into the provided shop-product list, or -1 for none. */
        shopProductIndex: z.number().int(),
        /** Optional non-shop affiliate pick for variety. */
        affiliatePick: z
          .object({
            name: z.string().min(4).max(80),
            amazonSearchQuery: z.string().min(4).max(80),
            why: z.string().min(30).max(220),
          })
          .nullable(),
      }),
    )
    .min(4)
    .max(8),
  outro: z.string().min(60),
});

const SYSTEM_PROMPT = `You are Sage, the content writer for Gotcha Day Goods' gift-guide site — warm, practical, pet-parent-first. You write genuinely useful gift guides for pet parents (rescue/adoption culture, gotcha days, senior pets, memorials, dog/cat moms).

Rules:
- Write like a knowledgeable friend, not a catalog. Specific, warm, zero fluff.
- Feature the provided SHOP PRODUCTS naturally where they genuinely fit (reference by index). Do not force every section to sell.
- affiliatePick items are OTHER products a pet parent would buy (toys, treats, comfort items, keepsake supplies) — real product categories, generic names (no brand claims we can't verify).
- NEVER: medical/health claims, guaranteed outcomes, invented reviews or statistics, copyrighted characters/brands as the product.
- Titles are search-shaped: "[Number] [Occasion/Recipient] Gift Ideas..." style pet parents actually search.`;

type ShopProduct = {
  title: string;
  url: string;
  image: string | null;
  price: number | null;
};

function buildUserPrompt(products: ShopProduct[], trendBrief: string | null) {
  return [
    "Write today's gift guide.",
    "",
    "SHOP PRODUCTS (our own — reference by zero-based index where they fit):",
    ...products.map(
      (p, i) => `${i}. ${p.title}${p.price ? ` — $${p.price}` : ""}`,
    ),
    trendBrief?.trim()
      ? `\nTREND CONTEXT (weave in seasonal angles where natural):\n${trendBrief.trim()}`
      : "",
    "",
    "Pick ONE clear guide angle (an occasion, recipient, or moment — e.g. gotcha day gifts, senior dog comfort, memorial keepsakes, new-rescue-parent starter kit). 4-8 sections. Each section: helpful body copy; a shop product index where one genuinely fits (else -1); optionally one affiliatePick.",
  ].join("\n");
}

const GUIDE_JSON_INSTRUCTIONS = `Return JSON:
{
  "title": "string (search-shaped guide title, 20-90 chars)",
  "description": "string (meta description, 60-180 chars)",
  "intro": "string (opening paragraphs, markdown ok)",
  "sections": [
    {
      "heading": "string",
      "body": "string (markdown ok)",
      "shopProductIndex": number (index into shop products, or -1),
      "affiliatePick": { "name": "string", "amazonSearchQuery": "string", "why": "string" } | null
    }
  ] (4-8 sections),
  "outro": "string"
}`;

/** Generate + publish today's guide. No-op when one was made in the last 20h. */
export async function generateDailyGuide(
  supabase: Supabase,
  userId: string,
): Promise<{ ok: boolean; slug?: string; skipped?: string; error?: string }> {
  // Once a day.
  const since = new Date(Date.now() - 20 * 3_600_000).toISOString();
  const { data: recent } = await supabase
    .from(TABLES.GUIDES)
    .select("id")
    .eq("user_id", userId)
    .gte("created_at", since)
    .limit(1);
  if ((recent ?? []).length > 0) return { ok: true, skipped: "daily_cap" };

  const { data: listings } = await supabase
    .from(TABLES.LISTINGS)
    .select("title, gumroad_url, mockup_url, price")
    .eq("user_id", userId)
    .eq("status", "published")
    .not("gumroad_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(14);
  const products: ShopProduct[] = (listings ?? [])
    .filter((l) => l.title && l.gumroad_url)
    .map((l) => ({
      title: l.title as string,
      url: l.gumroad_url as string,
      image: l.mockup_url ?? null,
      price: l.price != null ? Number(l.price) : null,
    }));
  if (products.length < 4) {
    return { ok: false, error: "not enough published products for a guide" };
  }

  const trendBrief = await fetchTrendBrief(supabase, userId);

  let guide;
  try {
    const result = await completeJson({
      task: "listing",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(products, trendBrief) },
      ],
      schema: GuideSchema,
      jsonInstructions: GUIDE_JSON_INSTRUCTIONS,
      options: { temperature: 0.7, maxTokens: 3500 },
      timeout: 60_000,
    });
    guide = result.data;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "guide generation failed",
    };
  }

  // Assemble markdown with tracked links.
  const parts: string[] = [guide.intro.trim(), ""];
  let heroImage: string | null = null;
  for (const section of guide.sections) {
    parts.push(`## ${section.heading.trim()}`, "", section.body.trim(), "");
    const product = products[section.shopProductIndex] ?? null;
    if (product) {
      if (!heroImage && product.image) heroImage = product.image;
      const go = await ensureLink(supabase, userId, {
        destinationUrl: product.url,
        network: "etsy_own",
        label: product.title,
        slug: slugify(product.title),
      });
      parts.push(
        `**Our pick:** [${product.title}](${go})${product.price ? ` — $${product.price}` : ""} *(from our shop)*`,
        "",
      );
    }
    if (section.affiliatePick) {
      const query = section.affiliatePick.amazonSearchQuery.trim();
      const go = await ensureLink(supabase, userId, {
        destinationUrl: `https://www.amazon.com/s?k=${encodeURIComponent(query)}`,
        network: "amazon",
        label: section.affiliatePick.name,
        slug: slugify(`amz-${section.affiliatePick.name}`),
      });
      parts.push(
        `**Also worth a look:** [${section.affiliatePick.name}](${go}) — ${section.affiliatePick.why.trim()}`,
        "",
      );
    }
  }
  parts.push(guide.outro.trim(), "", "---", "", AFFILIATE_DISCLOSURE);

  const slug = `${slugify(guide.title)}-${new Date().toISOString().slice(0, 10)}`;
  const { error: insertError } = await supabase.from(TABLES.GUIDES).insert({
    user_id: userId,
    slug,
    title: guide.title.trim(),
    description: guide.description.trim(),
    hero_image_url: heroImage,
    content_md: parts.join("\n"),
    status: "published",
  });
  if (insertError) return { ok: false, error: insertError.message };

  // Cross-promote: stage a social post pointing at the guide (extra
  // non-salesy Pinterest/IG content that funnels into the shop).
  const baseUrl = process.env.PUBLIC_SITE_URL?.trim() || "https://octane-ajax.vercel.app";
  await supabase.from(TABLES.CONTENT_JOBS).insert({
    user_id: userId,
    listing_id: null,
    platform: "social",
    content_type: "promo",
    status: "scheduled",
    caption: `${guide.title} 🐾 Full guide on our site — every pick chosen for rescue-pet parents.`,
    asset_url: heroImage,
    scheduled_for: new Date(Date.now() + 3_600_000).toISOString(),
    metadata: {
      pillar: "relatable",
      hashtags: ["petgiftguide", "rescuedogmom", "gotchaday", "dogmomlife"],
      productUrl: `${baseUrl}/guides/${slug}`,
      source: { kind: "guide", slug },
    } as unknown as Json,
  });

  await supabase.from(TABLES.EVENTS).insert({
    user_id: userId,
    event_type: "guide_published",
    message: `Sage published a gift guide: "${guide.title.slice(0, 80)}" (/guides/${slug})`,
    agent_slug: "pixel",
    room: "media_studio",
    metadata: { slug, sections: guide.sections.length } as unknown as Json,
  });

  return { ok: true, slug };
}

export const AFFILIATE_DISCLOSURE =
  "*Some links on this page may earn us a small commission at no extra cost to you. Shop picks are from our own Gotcha Day Goods store.*";
