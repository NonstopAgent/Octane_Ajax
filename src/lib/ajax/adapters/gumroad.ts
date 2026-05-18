/**
 * Gumroad marketplace adapter — server-side only.
 *
 * Uses GUMROAD_ACCESS_TOKEN (OAuth access token with edit_products scope).
 * Never import from Client Components.
 */

const GUMROAD_API_BASE = "https://api.gumroad.com/v2";

export class GumroadAdapterError extends Error {
  readonly code = "GUMROAD_ADAPTER_ERROR" as const;

  constructor(
    message: string,
    readonly statusCode?: number,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "GumroadAdapterError";
  }
}

export type GumroadCreateProductInput = {
  name: string;
  description: string;
  price_cents: number;
  published?: boolean;
};

export type GumroadCreateProductResult = {
  product_id: string;
  short_url: string;
};

export interface GumroadAdapter {
  createProduct(
    input: GumroadCreateProductInput,
  ): Promise<GumroadCreateProductResult>;
  uploadProductFile(
    productId: string,
    fileBuffer: Buffer,
    filename: string,
  ): Promise<void>;
  publishProduct(productId: string): Promise<void>;
}

type GumroadApiEnvelope = {
  success?: boolean;
  message?: string;
  product?: {
    id?: string;
    short_url?: string;
    url?: string;
  };
};

export type GumroadAdapterOptions = {
  accessToken?: string;
  fetchImpl?: typeof fetch;
};

function getAccessToken(explicit?: string): string {
  const token = explicit ?? process.env.GUMROAD_ACCESS_TOKEN?.trim();
  if (!token) {
    throw new GumroadAdapterError(
      "GUMROAD_ACCESS_TOKEN is not configured.",
      undefined,
    );
  }
  return token;
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

async function parseGumroadJson(
  response: Response,
): Promise<GumroadApiEnvelope> {
  const text = await response.text();
  let body: GumroadApiEnvelope = {};
  if (text) {
    try {
      body = JSON.parse(text) as GumroadApiEnvelope;
    } catch {
      throw new GumroadAdapterError(
        `Gumroad returned non-JSON (${response.status}).`,
        response.status,
      );
    }
  }

  if (!response.ok || body.success === false) {
    throw new GumroadAdapterError(
      body.message ?? `Gumroad API error (${response.status}).`,
      response.status,
    );
  }

  return body;
}

function productIdFromBody(body: GumroadApiEnvelope): string {
  const id = body.product?.id?.trim();
  if (!id) {
    throw new GumroadAdapterError("Gumroad response missing product id.");
  }
  return id;
}

function shortUrlFromBody(body: GumroadApiEnvelope): string {
  const url = (body.product?.short_url ?? body.product?.url)?.trim();
  if (!url) {
    throw new GumroadAdapterError("Gumroad response missing product URL.");
  }
  return url;
}

/** Map listing.price (USD decimal) to Gumroad cents; default $7.99. */
export function listingPriceToCents(price: number | null | undefined): number {
  if (price == null || !Number.isFinite(price) || price <= 0) {
    return 799;
  }
  return Math.max(100, Math.round(price * 100));
}

export function createGumroadAdapter(
  options: GumroadAdapterOptions = {},
): GumroadAdapter {
  const fetchImpl = options.fetchImpl ?? fetch;

  async function request(
    method: string,
    path: string,
    init: RequestInit & { form?: URLSearchParams },
  ): Promise<GumroadApiEnvelope> {
    const token = getAccessToken(options.accessToken);
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);

    let body: BodyInit | undefined = init.body ?? undefined;
    if (init.form) {
      headers.set("Content-Type", "application/x-www-form-urlencoded");
      body = init.form.toString();
    }

    const response = await fetchImpl(`${GUMROAD_API_BASE}${path}`, {
      ...init,
      method,
      headers,
      body,
    });

    return parseGumroadJson(response);
  }

  return {
    async createProduct(input) {
      const form = new URLSearchParams();
      form.set("name", input.name);
      form.set("description", input.description);
      form.set("price", String(input.price_cents));
      form.set("published", String(input.published ?? false));

      const body = await request("POST", "/products", { form });
      return {
        product_id: productIdFromBody(body),
        short_url: shortUrlFromBody(body),
      };
    },

    async uploadProductFile(productId, fileBuffer, filename) {
      const token = getAccessToken(options.accessToken);
      const form = new FormData();
      form.append(
        "file",
        new Blob([Uint8Array.from(fileBuffer)], { type: "application/pdf" }),
        filename,
      );

      const response = await fetchImpl(
        `${GUMROAD_API_BASE}/products/${encodeURIComponent(productId)}/files`,
        {
          method: "POST",
          headers: authHeaders(token),
          body: form,
        },
      );

      await parseGumroadJson(response);
    },

    async publishProduct(productId) {
      const form = new URLSearchParams();
      form.set("published", "true");
      await request("PUT", `/products/${encodeURIComponent(productId)}`, {
        form,
      });
    },
  };
}
