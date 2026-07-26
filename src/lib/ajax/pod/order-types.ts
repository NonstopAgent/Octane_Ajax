/**
 * Room 2 — Personalized-on-Order queue types, status machine, and IP guardrails.
 */

export const ORDER_QUEUE_STATUSES = [
  "pending_personalization",
  "processing_artwork",
  "fulfillment_ready",
  "production_submitted",
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
  // processing_artwork → pending_personalization is the RECLAIM path: a
  // fire-and-forget personalization frozen mid-flight (lambda suspended after
  // the response) used to leave the row in processing_artwork forever — the
  // paid order was never retried (2026-07-25 audit, H4).
  processing_artwork: ["fulfillment_ready", "pending_personalization", "failed"],
  fulfillment_ready: ["production_submitted", "failed"],
  production_submitted: [],
  failed: [],
};

export type OrderQueueRow = {
  id: string;
  user_id: string;
  etsy_order_id: string;
  /** Etsy transaction_id ('' for legacy/receipt-level rows) — one row per line item (H5). */
  transaction_id: string;
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

/** Etsy receipt shipping fields (Open API v3 receipt / transaction webhook). */
export type EtsyShippingAddress = {
  name?: string;
  first_line?: string;
  second_line?: string;
  city?: string;
  state?: string;
  zip?: string;
  country_iso?: string;
  formatted_address?: string;
};

export type EtsyPersonalizationFields = {
  photo_url?: string;
  customer_photo_url?: string;
  image_url?: string;
  upload_url?: string;
  style?: string;
  style_preference?: string;
};

export type EtsyTransactionPayload = {
  listing_id?: string | number;
  transaction_id?: string | number;
  quantity?: number;
  variations?: Array<{ formatted_name?: string; formatted_value?: string }>;
  personalization?: EtsyPersonalizationFields;
};

/**
 * Etsy order webhook payload — supports mock dev shape and live receipt fields.
 *
 * Live Etsy receipts include `receipt_id`, buyer/shipping top-level fields, and
 * `transactions[]` with `listing_id` + variation personalization (photo URL, style).
 * Event wrappers (`data`, `receipt`) are normalized via `normalizeEtsyWebhookPayload`.
 */
export type EtsyOrderWebhookPayload = {
  receipt_id?: string | number;
  order_id?: string | number;
  listing_id?: string | number;
  buyer_email?: string;
  name?: string;
  first_line?: string;
  second_line?: string;
  city?: string;
  state?: string;
  zip?: string;
  country_iso?: string;
  shipping_address?: EtsyShippingAddress;
  personalization?: EtsyPersonalizationFields;
  transactions?: EtsyTransactionPayload[];
  /** Etsy event wrapper — inner receipt object. */
  data?: EtsyOrderWebhookPayload;
  receipt?: EtsyOrderWebhookPayload;
};

export type EtsyOrderShippingInfo = {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  country: string;
  region: string | null;
  address1: string;
  address2: string | null;
  city: string;
  zip: string;
};

/** Unwraps nested Etsy event envelopes to the receipt payload. */
export function normalizeEtsyWebhookPayload(
  raw: EtsyOrderWebhookPayload,
): EtsyOrderWebhookPayload {
  if (raw.data && typeof raw.data === "object") {
    return { ...raw.data, ...raw, data: undefined };
  }
  if (raw.receipt && typeof raw.receipt === "object") {
    return { ...raw.receipt, ...raw, receipt: undefined };
  }
  return raw;
}

function splitRecipientName(fullName: string): { firstName: string; lastName: string } {
  const trimmed = fullName.trim();
  if (!trimmed) {
    return { firstName: "Customer", lastName: "Order" };
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0]!, lastName: "—" };
  }
  return {
    firstName: parts[0]!,
    lastName: parts.slice(1).join(" "),
  };
}

function photoFromPersonalization(
  personalization?: EtsyPersonalizationFields,
): string | null {
  if (!personalization) return null;
  return (
    personalization.photo_url?.trim() ||
    personalization.customer_photo_url?.trim() ||
    personalization.image_url?.trim() ||
    personalization.upload_url?.trim() ||
    null
  );
}

function styleFromPersonalization(
  personalization?: EtsyPersonalizationFields,
): string | null {
  if (!personalization) return null;
  return (
    personalization.style?.trim() ||
    personalization.style_preference?.trim() ||
    null
  );
}

/**
 * Personalization spend is bounded (2026-07-25 audit, C2): `quantity` used to
 * be copied verbatim into production, so a single crafted payload could
 * submit a 500-unit billable Printify order. Personalized gifts are 1–2 in
 * practice; anything above this is parked at the clamp for a human to notice.
 */
export const MAX_ORDER_QUANTITY = 10;

/** A buyer-chosen listing option (Size / Color / …) — NOT personalization. */
export type BuyerVariation = { name: string; value: string };

function isPersonalizationVariationName(name: string): boolean {
  return (
    name.includes("photo") ||
    name.includes("image") ||
    name.includes("upload") ||
    name.includes("picture") ||
    name.includes("style") ||
    name.includes("aesthetic") ||
    name.includes("art") ||
    name.includes("personal")
  );
}

export function extractPersonalizationFromWebhook(
  payload: EtsyOrderWebhookPayload,
): {
  etsyOrderId: string;
  /** Etsy transaction_id of the line item this order row represents. */
  transactionId: string | null;
  listingId: string | null;
  customerPhotoUrl: string | null;
  rawStyle: string | null;
  quantity: number;
  /** Size/Color-type choices from the same line item (drives variant pick, H6). */
  buyerVariations: BuyerVariation[];
} {
  const normalized = normalizeEtsyWebhookPayload(payload);

  const etsyOrderId = String(
    normalized.receipt_id ?? normalized.order_id ?? "",
  ).trim();

  let customerPhotoUrl = photoFromPersonalization(normalized.personalization);
  let rawStyle = styleFromPersonalization(normalized.personalization);

  const transactions = normalized.transactions ?? [];

  // The transaction that CARRIES the personalization is the line item this
  // order row is about — its id, quantity, listing, and size/color choices
  // must all come from the same place. Multi-item receipts arrive as one
  // payload per transaction from the intake poller (H5).
  let sourceTx: EtsyTransactionPayload | null = null;

  let listingId =
    normalized.listing_id != null ? String(normalized.listing_id) : null;

  for (const tx of transactions) {
    let contributed = false;

    if (!customerPhotoUrl) {
      customerPhotoUrl = photoFromPersonalization(tx.personalization);
      contributed = contributed || Boolean(customerPhotoUrl);
    }
    if (!rawStyle) {
      rawStyle = styleFromPersonalization(tx.personalization);
      contributed = contributed || Boolean(rawStyle);
    }

    for (const variation of tx.variations ?? []) {
      const name = variation.formatted_name?.toLowerCase() ?? "";
      const value = variation.formatted_value?.trim() ?? "";
      if (!value) continue;
      if (
        !customerPhotoUrl &&
        (name.includes("photo") ||
          name.includes("image") ||
          name.includes("upload") ||
          name.includes("picture"))
      ) {
        customerPhotoUrl = value;
        contributed = true;
      }
      if (
        !rawStyle &&
        (name.includes("style") || name.includes("aesthetic") || name.includes("art"))
      ) {
        rawStyle = value;
        contributed = true;
      }
    }

    if (contributed && !sourceTx) {
      sourceTx = tx;
    }
  }

  // Receipt-level personalization (mock/dev payloads): attribute the order to
  // the first line item so ids and variant choices still line up.
  if (!sourceTx && transactions.length > 0) {
    sourceTx = transactions[0]!;
  }

  if (listingId == null && sourceTx?.listing_id != null) {
    listingId = String(sourceTx.listing_id);
  }

  const transactionId =
    sourceTx?.transaction_id != null ? String(sourceTx.transaction_id) : null;

  const rawQuantity =
    typeof sourceTx?.quantity === "number" && sourceTx.quantity > 0
      ? sourceTx.quantity
      : 1;
  const quantity = Math.min(rawQuantity, MAX_ORDER_QUANTITY);

  const buyerVariations: BuyerVariation[] = [];
  for (const variation of sourceTx?.variations ?? []) {
    const rawName = variation.formatted_name?.trim() ?? "";
    const value = variation.formatted_value?.trim() ?? "";
    if (!rawName || !value) continue;
    if (isPersonalizationVariationName(rawName.toLowerCase())) continue;
    buyerVariations.push({ name: rawName, value });
    if (buyerVariations.length >= 5) break;
  }

  return {
    etsyOrderId,
    transactionId,
    listingId,
    customerPhotoUrl,
    rawStyle,
    quantity,
    buyerVariations,
  };
}

/** Extracts Printify-ready shipping from Etsy receipt / shipping_address fields. */
export function extractShippingFromWebhook(
  payload: EtsyOrderWebhookPayload,
): EtsyOrderShippingInfo | null {
  const normalized = normalizeEtsyWebhookPayload(payload);
  const ship = normalized.shipping_address;

  const address1 = (ship?.first_line ?? normalized.first_line)?.trim() ?? "";
  const city = (ship?.city ?? normalized.city)?.trim() ?? "";
  const zip = (ship?.zip ?? normalized.zip)?.trim() ?? "";
  const country = (ship?.country_iso ?? normalized.country_iso)?.trim() ?? "";

  if (!address1 || !city || !zip || !country) {
    return null;
  }

  const recipientName = (ship?.name ?? normalized.name)?.trim() ?? "";
  const { firstName, lastName } = splitRecipientName(recipientName);

  return {
    firstName,
    lastName,
    email: normalized.buyer_email?.trim() || null,
    phone: null,
    country,
    region: (ship?.state ?? normalized.state)?.trim() || null,
    address1,
    address2: (ship?.second_line ?? normalized.second_line)?.trim() || null,
    city,
    zip,
  };
}

/** Demo shipping used when Etsy payload omits address (local dev only). */
export function demoShippingForOrder(_etsyOrderId: string): EtsyOrderShippingInfo {
  return {
    firstName: "Demo",
    lastName: "Customer",
    email: "demo@octane-ajax.local",
    phone: null,
    country: "US",
    region: "CA",
    address1: "123 Demo Street",
    address2: null,
    city: "Los Angeles",
    zip: "90001",
  };
}
