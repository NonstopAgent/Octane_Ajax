/**
 * Etsy Open API v3 adapter — server-side only.
 *
 * Uses ETSY_CLIENT_ID for x-api-key and per-user OAuth Bearer tokens.
 * Never import from Client Components.
 */

import { listingPriceToCents } from "@/lib/ajax/adapters/gumroad";

const ETSY_API_BASE = "https://api.etsy.com/v3/application";

/** Digital downloads taxonomy (user-specified). */
export const ETSY_DIGITAL_TAXONOMY_ID = 2078;

export class EtsyAdapterError extends Error {
  readonly code = "ETSY_ADAPTER_ERROR" as const;

  constructor(
    message: string,
    readonly statusCode?: number,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "EtsyAdapterError";
  }
}

export type EtsyCreateDraftListingInput = {
  title: string;
  description: string;
  price_cents: number;
  tags?: string[];
  shopId: string;
  accessToken: string;
};

export type EtsyCreateDraftListingResult = {
  listing_id: string;
  url: string;
};

export type EtsyAdapterOptions = {
  clientId?: string;
  fetchImpl?: typeof fetch;
};

function getClientId(explicit?: string): string {
  const clientId = explicit ?? process.env.ETSY_CLIENT_ID?.trim();
  if (!clientId) {
    throw new EtsyAdapterError("ETSY_CLIENT_ID is not configured.");
  }
  return clientId;
}

function authHeaders(clientId: string, accessToken: string): HeadersInit {
  return {
    "x-api-key": clientId,
    Authorization: `Bearer ${accessToken}`,
  };
}

async function parseEtsyJson<T extends Record<string, unknown>>(
  response: Response,
): Promise<T> {
  const text = await response.text();
  let body: T & { error?: string } = {} as T;
  if (text) {
    try {
      body = JSON.parse(text) as T & { error?: string };
    } catch {
      throw new EtsyAdapterError(
        `Etsy returned non-JSON (${response.status}).`,
        response.status,
      );
    }
  }

  if (!response.ok) {
    throw new EtsyAdapterError(
      (body.error as string | undefined) ??
        `Etsy API error (${response.status}).`,
      response.status,
    );
  }

  return body;
}

function listingUrlFromResponse(
  listingId: string,
  body: { url?: string },
): string {
  const url = body.url?.trim();
  if (url) return url;
  return `https://www.etsy.com/listing/${listingId}`;
}

export function createEtsyAdapter(options: EtsyAdapterOptions = {}) {
  const clientId = getClientId(options.clientId);
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async createDraftListing(
      input: EtsyCreateDraftListingInput,
    ): Promise<EtsyCreateDraftListingResult> {
      const body = new URLSearchParams();
      body.set("quantity", "999");
      body.set("title", input.title.trim() || "Digital product");
      body.set("description", input.description.trim() || "Digital download.");
      body.set("price", String(input.price_cents));
      body.set("who_made", "i_did");
      body.set("when_made", "2020_2025");
      body.set("taxonomy_id", String(ETSY_DIGITAL_TAXONOMY_ID));
      body.set("type", "download");
      body.set("state", "active");
      body.set("is_supply", "false");

      const tags = (input.tags ?? [])
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 13);
      for (const tag of tags) {
        body.append("tags[]", tag);
      }

      const response = await fetchImpl(
        `${ETSY_API_BASE}/shops/${input.shopId}/listings`,
        {
          method: "POST",
          headers: {
            ...authHeaders(clientId, input.accessToken),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: body.toString(),
        },
      );

      const parsed = await parseEtsyJson<{
        listing_id?: number;
        url?: string;
      }>(response);

      const listingId =
        parsed.listing_id != null ? String(parsed.listing_id) : null;
      if (!listingId) {
        throw new EtsyAdapterError("Etsy response missing listing_id.");
      }

      return {
        listing_id: listingId,
        url: listingUrlFromResponse(listingId, parsed),
      };
    },

    async uploadListingFile(
      listingId: string,
      fileBuffer: Buffer,
      filename: string,
      shopId: string,
      accessToken: string,
    ): Promise<void> {
      const form = new FormData();
      form.append(
        "file",
        new Blob([new Uint8Array(fileBuffer)], { type: "application/pdf" }),
        filename,
      );

      const response = await fetchImpl(
        `${ETSY_API_BASE}/shops/${shopId}/listings/${listingId}/files`,
        {
          method: "POST",
          headers: authHeaders(clientId, accessToken),
          body: form,
        },
      );

      if (!response.ok) {
        await parseEtsyJson(response);
      }
    },
  };
}

export { listingPriceToCents };
