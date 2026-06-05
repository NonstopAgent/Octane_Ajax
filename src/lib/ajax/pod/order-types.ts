/**
 * Room 2 — Personalized-on-Order queue types, status machine, and IP guardrails.
 */

export const ORDER_QUEUE_STATUSES = [
  "pending_personalization",
  "processing_artwork",
  "fulfillment_ready",
  "failed",
] as const;

export type OrderQueueStatus = (typeof ORDER_QUEUE_STATUSES)[number];

export const ORDER_ROOM_SLUG = "personalization_bay" as const;

/** Allowed style presets — user-facing labels rewritten into original art prompts. */
export const STYLE_PRESET_PROMPTS: Record<string, string> = {
  watercolor:
    "Soft watercolor portrait with gentle brush strokes, pastel washes, and hand-painted texture. Original artwork only.",
  renaissance:
    "Classical Renaissance oil-painting portrait with rich chiaroscuro lighting and timeless fine-art composition. Original artwork only.",
  "line-art":
    "Clean minimalist line-art portrait with confident ink strokes, open negative space, and print-ready contrast. Original artwork only.",
  "pop-art":
    "Bold pop-art portrait with vibrant flat color blocks, halftone accents, and graphic poster energy. Original artwork only.",
};

export const INFRINGING_TERMS = [
  "simpsons",
  "marvel",
  "disney",
  "pixar",
  "dc comics",
  "batman",
  "superman",
  "spider-man",
  "spiderman",
  "avengers",
  "mickey mouse",
  "minnie mouse",
  "frozen",
  "star wars",
  "harry potter",
  "pokemon",
  "pikachu",
  "nintendo",
  "mario",
  "zelda",
  "naruto",
  "dragon ball",
  "hello kitty",
  "barbie",
  "lego",
  "nike",
  "gucci",
  "louis vuitton",
  "coca-cola",
  "pepsi",
  "mcdonalds",
  "superhero",
  "superheroes",
  "comic book character",
  "cartoon character",
  "trademark",
  "copyrighted",
] as const;

const VALID_TRANSITIONS: Record<OrderQueueStatus, readonly OrderQueueStatus[]> = {
  pending_personalization: ["processing_artwork", "failed"],
  processing_artwork: ["fulfillment_ready", "failed"],
  fulfillment_ready: [],
  failed: [],
};

export type OrderQueueRow = {
  id: string;
  user_id: string;
  etsy_order_id: string;
  listing_id: string | null;
  customer_photo_url: string;
  style_prompt: string;
  status: OrderQueueStatus;
  printify_product_id: string | null;
  printify_upload_id: string | null;
  artwork_url: string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type StyleSanitizeResult =
  | { ok: true; prompt: string; preset: string | null }
  | { ok: false; reason: string; blockedTerms?: string[] };

export type InfringingCheckResult = {
  blocked: boolean;
  terms: string[];
};

export function isOrderQueueStatus(value: string): value is OrderQueueStatus {
  return (ORDER_QUEUE_STATUSES as readonly string[]).includes(value);
}

export function canTransitionOrderStatus(
  from: OrderQueueStatus,
  to: OrderQueueStatus,
): boolean {
  if (from === to) return true;
  return VALID_TRANSITIONS[from].includes(to);
}

export function assertOrderStatusTransition(
  from: OrderQueueStatus,
  to: OrderQueueStatus,
): void {
  if (!canTransitionOrderStatus(from, to)) {
    throw new Error(`Invalid order status transition: ${from} → ${to}`);
  }
}

function normalizeStyleKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

function findInfringingTerms(text: string): string[] {
  const lower = text.toLowerCase();
  return INFRINGING_TERMS.filter((term) => lower.includes(term));
}

export function blockInfringingTerms(text: string): InfringingCheckResult {
  const terms = findInfringingTerms(text);
  return { blocked: terms.length > 0, terms };
}

/**
 * Rewrites user style choices into IP-safe original art prompts.
 * Blocks copyrighted franchise references before image generation.
 */
export function sanitizeStylePrompt(rawStyle: string): StyleSanitizeResult {
  const trimmed = rawStyle.trim();
  if (!trimmed) {
    return { ok: false, reason: "Style preference is required." };
  }

  const infringing = blockInfringingTerms(trimmed);
  if (infringing.blocked) {
    return {
      ok: false,
      reason: "Style request contains blocked copyrighted terms.",
      blockedTerms: infringing.terms,
    };
  }

  const presetKey = normalizeStyleKey(trimmed);
  const presetPrompt = STYLE_PRESET_PROMPTS[presetKey];
  if (presetPrompt) {
    return { ok: true, prompt: presetPrompt, preset: presetKey };
  }

  const genericPrompt = [
    `Original portrait artwork in a ${trimmed} aesthetic.`,
    "No logos, no recognizable characters, brands, or franchises.",
    "Print-ready composition suitable for personalized POD fulfillment.",
  ].join(" ");

  return { ok: true, prompt: genericPrompt, preset: null };
}

export function isValidCustomerPhotoUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("demo://")) return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/** Mock Etsy webhook payload shape (scaffold — live wiring in Phase 3). */
export type EtsyOrderWebhookPayload = {
  receipt_id?: string | number;
  order_id?: string | number;
  listing_id?: string | number;
  personalization?: {
    photo_url?: string;
    customer_photo_url?: string;
    style?: string;
    style_preference?: string;
  };
  transactions?: Array<{
    listing_id?: string | number;
    variations?: Array<{ formatted_name?: string; formatted_value?: string }>;
  }>;
};

export function extractPersonalizationFromWebhook(
  payload: EtsyOrderWebhookPayload,
): {
  etsyOrderId: string;
  listingId: string | null;
  customerPhotoUrl: string | null;
  rawStyle: string | null;
} {
  const etsyOrderId = String(
    payload.receipt_id ?? payload.order_id ?? "",
  ).trim();

  const personalization = payload.personalization ?? {};
  let customerPhotoUrl =
    personalization.photo_url?.trim() ||
    personalization.customer_photo_url?.trim() ||
    null;
  let rawStyle =
    personalization.style?.trim() ||
    personalization.style_preference?.trim() ||
    null;

  const listingId =
    payload.listing_id != null
      ? String(payload.listing_id)
      : payload.transactions?.[0]?.listing_id != null
        ? String(payload.transactions[0].listing_id)
        : null;

  if (!customerPhotoUrl || !rawStyle) {
    for (const tx of payload.transactions ?? []) {
      for (const variation of tx.variations ?? []) {
        const name = variation.formatted_name?.toLowerCase() ?? "";
        const value = variation.formatted_value?.trim() ?? "";
        if (!value) continue;
        if (
          !customerPhotoUrl &&
          (name.includes("photo") || name.includes("image") || name.includes("upload"))
        ) {
          customerPhotoUrl = value;
        }
        if (!rawStyle && name.includes("style")) {
          rawStyle = value;
        }
      }
    }
  }

  return { etsyOrderId, listingId, customerPhotoUrl, rawStyle };
}
