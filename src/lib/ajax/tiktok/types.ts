import type { TikTokSlideshowSlide } from "@/lib/ajax/pixel/tiktok-package";
import type { TikTokQueueStatusDb } from "@/lib/supabase/schema";

export type TikTokQueueRow = {
  id: string;
  user_id: string;
  product_generation_id: string;
  status: TikTokQueueStatusDb;
  caption: string;
  hashtags: string[];
  mockup_urls: string[];
  slideshow_script: TikTokSlideshowSlide[];
  created_at: string;
  updated_at: string;
};

function parseSlideshowScript(raw: unknown): TikTokSlideshowSlide[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((slide) => {
      if (!slide || typeof slide !== "object") return null;
      const record = slide as Record<string, unknown>;
      const image_index =
        typeof record.image_index === "number" ? record.image_index : null;
      const overlay_text =
        typeof record.overlay_text === "string" ? record.overlay_text.trim() : "";
      if (image_index == null || !overlay_text) return null;
      return { image_index, overlay_text };
    })
    .filter((slide): slide is TikTokSlideshowSlide => slide != null);
}

export function mapTikTokQueueRow(row: {
  id: string;
  user_id: string;
  product_generation_id: string;
  status: string;
  caption: string;
  hashtags: string[] | null;
  mockup_urls: string[] | null;
  slideshow_script: unknown;
  created_at: string;
  updated_at: string;
}): TikTokQueueRow {
  return {
    id: row.id,
    user_id: row.user_id,
    product_generation_id: row.product_generation_id,
    status: row.status as TikTokQueueStatusDb,
    caption: row.caption,
    hashtags: row.hashtags ?? [],
    mockup_urls: row.mockup_urls ?? [],
    slideshow_script: parseSlideshowScript(row.slideshow_script),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
