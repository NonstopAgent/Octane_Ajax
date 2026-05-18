/**
 * Lemon Squeezy store adapter — server-side only.
 *
 * Uses LEMONSQUEEZY_API_KEY (store id is resolved from GET /v1/stores).
 * Never import from Client Components.
 */

import { listingPriceToCents } from "@/lib/ajax/adapters/gumroad";

const LEMONSQUEEZY_API_BASE = "https://api.lemonsqueezy.com/v1";

export { listingPriceToCents };

let cachedStoreId: string | null = null;

export class LemonSqueezyAdapterError extends Error {
  readonly code = "LEMONSQUEEZY_ADAPTER_ERROR" as const;

  constructor(
    message: string,
    readonly statusCode?: number,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LemonSqueezyAdapterError";
  }
}

export type LemonSqueezyCreateProductInput = {
  name: string;
  description: string;
};

export type LemonSqueezyCreateProductResult = {
  product_id: string;
  buy_now_url: string | null;
};

export type LemonSqueezyDefaultVariantResult = {
  variant_id: string;
};

export type LemonSqueezyPublishProductResult = {
  product_id: string;
  buy_now_url: string;
};

export interface LemonSqueezyAdapter {
  createProduct(
    input: LemonSqueezyCreateProductInput,
  ): Promise<LemonSqueezyCreateProductResult>;
  getDefaultVariant(
    productId: string,
  ): Promise<LemonSqueezyDefaultVariantResult>;
  setVariantPrice(variantId: string, priceCents: number): Promise<void>;
  uploadFile(
    variantId: string,
    fileBuffer: Buffer,
    filename: string,
  ): Promise<void>;
  publishProduct(productId: string): Promise<LemonSqueezyPublishProductResult>;
}

type JsonApiResource<T extends Record<string, unknown>> = {
  type?: string;
  id?: string;
  attributes?: T;
};

type JsonApiDocument<T extends Record<string, unknown>> = {
  data?: JsonApiResource<T> | JsonApiResource<T>[];
  errors?: { detail?: string; title?: string }[];
};

export type LemonSqueezyAdapterOptions = {
  apiKey?: string;
  /** Test override — skips GET /v1/stores when set. */
  storeId?: string;
  fetchImpl?: typeof fetch;
};

function getApiKey(explicit?: string): string {
  const key = explicit ?? process.env.LEMONSQUEEZY_API_KEY?.trim();
  if (!key) {
    throw new LemonSqueezyAdapterError(
      "LEMONSQUEEZY_API_KEY is not configured.",
      undefined,
    );
  }
  return key;
}

function jsonApiHeaders(apiKey: string): HeadersInit {
  return {
    Accept: "application/vnd.api+json",
    "Content-Type": "application/vnd.api+json",
    Authorization: `Bearer ${apiKey}`,
  };
}

function errorMessage(
  body: JsonApiDocument<Record<string, unknown>>,
  status: number,
): string {
  const detail = body.errors?.[0]?.detail ?? body.errors?.[0]?.title;
  return detail ?? `Lemon Squeezy API error (${status}).`;
}

async function parseJsonApi<T extends Record<string, unknown>>(
  response: Response,
): Promise<JsonApiDocument<T>> {
  const text = await response.text();
  let body: JsonApiDocument<T> = {};
  if (text) {
    try {
      body = JSON.parse(text) as JsonApiDocument<T>;
    } catch {
      throw new LemonSqueezyAdapterError(
        `Lemon Squeezy returned non-JSON (${response.status}).`,
        response.status,
      );
    }
  }

  if (!response.ok) {
    throw new LemonSqueezyAdapterError(
      errorMessage(body, response.status),
      response.status,
    );
  }

  return body;
}

function resourceId(
  resource: JsonApiResource<Record<string, unknown>> | undefined,
  label: string,
): string {
  const id = resource?.id?.trim();
  if (!id) {
    throw new LemonSqueezyAdapterError(`Lemon Squeezy response missing ${label}.`);
  }
  return id;
}

function buyNowUrl(
  attrs: { buy_url?: string | null; buy_now_url?: string | null } | undefined,
): string | null {
  const url = (attrs?.buy_url ?? attrs?.buy_now_url)?.trim();
  return url || null;
}

/** Resolves the first Lemon Squeezy store id (cached for process lifetime). */
export async function getStoreId(
  apiKey: string,
  fetchImpl: typeof fetch,
  explicit?: string,
): Promise<string> {
  const override = explicit?.trim();
  if (override) {
    return override;
  }

  if (cachedStoreId) {
    return cachedStoreId;
  }

  const response = await fetchImpl(`${LEMONSQUEEZY_API_BASE}/stores`, {
    method: "GET",
    headers: jsonApiHeaders(apiKey),
  });
  const body = await parseJsonApi<Record<string, unknown>>(response);
  const stores = Array.isArray(body.data)
    ? body.data
    : body.data
      ? [body.data]
      : [];
  const id = stores[0]?.id?.trim();
  if (!id) {
    throw new LemonSqueezyAdapterError(
      "Lemon Squeezy response missing store id.",
    );
  }

  cachedStoreId = id;
  return id;
}

export function createLemonSqueezyAdapter(
  options: LemonSqueezyAdapterOptions = {},
): LemonSqueezyAdapter {
  const fetchImpl = options.fetchImpl ?? fetch;

  async function requestJson<T extends Record<string, unknown>>(
    method: string,
    path: string,
    payload?: unknown,
  ): Promise<JsonApiDocument<T>> {
    const apiKey = getApiKey(options.apiKey);
    const response = await fetchImpl(`${LEMONSQUEEZY_API_BASE}${path}`, {
      method,
      headers: jsonApiHeaders(apiKey),
      body: payload ? JSON.stringify(payload) : undefined,
    });
    return parseJsonApi<T>(response);
  }

  return {
    async createProduct(input) {
      const apiKey = getApiKey(options.apiKey);
      const storeId = await getStoreId(apiKey, fetchImpl, options.storeId);
      const body = await requestJson<{ buy_url?: string }>("POST", "/products", {
        data: {
          type: "products",
          attributes: {
            name: input.name,
            description: input.description,
            status: "draft",
          },
          relationships: {
            store: {
              data: { type: "stores", id: storeId },
            },
          },
        },
      });

      const data = Array.isArray(body.data) ? body.data[0] : body.data;

      return {
        product_id: resourceId(data, "product id"),
        buy_now_url: buyNowUrl(data?.attributes),
      };
    },

    async getDefaultVariant(productId) {
      const body = await requestJson("GET", `/variants?filter[product_id]=${encodeURIComponent(productId)}`);
      const variants = Array.isArray(body.data) ? body.data : body.data ? [body.data] : [];
      const first = variants[0];
      if (!first) {
        throw new LemonSqueezyAdapterError(
          "Lemon Squeezy response missing default variant.",
        );
      }
      return { variant_id: resourceId(first, "variant id") };
    },

    async setVariantPrice(variantId, priceCents) {
      await requestJson("PATCH", `/variants/${encodeURIComponent(variantId)}`, {
        data: {
          type: "variants",
          id: variantId,
          attributes: { price: priceCents },
        },
      });
    },

    async uploadFile(variantId, fileBuffer, filename) {
      const apiKey = getApiKey(options.apiKey);
      const form = new FormData();
      form.append(
        "file",
        new Blob([Uint8Array.from(fileBuffer)], { type: "application/pdf" }),
        filename,
      );
      form.append("file_name", filename);
      form.append("variant_id", variantId);

      const response = await fetchImpl(`${LEMONSQUEEZY_API_BASE}/files`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: form,
      });

      await parseJsonApi(response);
    },

    async publishProduct(productId) {
      const body = await requestJson<{ buy_url?: string }>(
        "PATCH",
        `/products/${encodeURIComponent(productId)}`,
        {
          data: {
            type: "products",
            id: productId,
            attributes: { status: "published" },
          },
        },
      );

      const data = Array.isArray(body.data) ? body.data[0] : body.data;
      const url = buyNowUrl(data?.attributes);
      if (!url) {
        throw new LemonSqueezyAdapterError(
          "Lemon Squeezy response missing buy_url after publish.",
        );
      }

      return { product_id: productId, buy_now_url: url };
    },
  };
}
