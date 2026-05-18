import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createLemonSqueezyAdapter,
  LemonSqueezyAdapterError,
  listingPriceToCents,
} from "@/lib/ajax/adapters/lemonsqueezy";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/vnd.api+json" },
  });
}

function storesResponse(id = "7"): Response {
  return jsonResponse({
    data: [{ type: "stores", id }],
  });
}

describe("lemonsqueezy adapter", () => {
  it("re-exports listing price to cents helper", () => {
    assert.equal(listingPriceToCents(9.99), 999);
  });

  it("createProduct fetches store id then posts JSON:API with store relationship", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = async (url: string | URL, init?: RequestInit) => {
      const urlStr = String(url);
      calls.push({ url: urlStr, init: init ?? {} });
      if (urlStr.endsWith("/v1/stores")) {
        return storesResponse("7");
      }
      return jsonResponse({
        data: {
          type: "products",
          id: "42",
          attributes: { buy_url: null },
        },
      });
    };

    const adapter = createLemonSqueezyAdapter({
      apiKey: "ls-key",
      fetchImpl,
    });

    const result = await adapter.createProduct({
      name: "Planner",
      description: "Weekly planner PDF",
    });

    assert.equal(result.product_id, "42");
    assert.equal(result.buy_now_url, null);
    assert.equal(calls.length, 2);
    assert.match(calls[0]!.url, /\/v1\/stores$/);
    assert.equal(calls[0]!.init.method, "GET");
    const storeHeaders = new Headers(calls[0]!.init.headers);
    assert.equal(storeHeaders.get("Authorization"), "Bearer ls-key");
    assert.equal(storeHeaders.get("Accept"), "application/vnd.api+json");
    assert.match(calls[1]!.url, /\/v1\/products$/);
    assert.equal(calls[1]!.init.method, "POST");
    const headers = new Headers(calls[1]!.init.headers);
    assert.equal(headers.get("Authorization"), "Bearer ls-key");
    assert.equal(headers.get("Accept"), "application/vnd.api+json");
    assert.equal(headers.get("Content-Type"), "application/vnd.api+json");
    const body = JSON.parse(String(calls[1]!.init.body)) as {
      data: {
        type: string;
        attributes: { status: string };
        relationships: { store: { data: { id: string; type: string } } };
      };
    };
    assert.equal(body.data.type, "products");
    assert.equal(body.data.attributes.status, "draft");
    assert.equal(body.data.relationships.store.data.id, "7");
    assert.equal(body.data.relationships.store.data.type, "stores");
  });

  it("getDefaultVariant GETs filter by product_id", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse({
        data: [{ type: "variants", id: "99" }],
      });
    };

    const adapter = createLemonSqueezyAdapter({
      apiKey: "ls-key",
      fetchImpl,
    });

    const result = await adapter.getDefaultVariant("42");
    assert.equal(result.variant_id, "99");
    assert.match(calls[0]!.url, /\/v1\/variants\?filter\[product_id\]=42$/);
    assert.equal(calls[0]!.init.method, "GET");
  });

  it("setVariantPrice PATCHes price in cents", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse({
        data: { type: "variants", id: "99", attributes: { price: 1299 } },
      });
    };

    const adapter = createLemonSqueezyAdapter({
      apiKey: "ls-key",
      fetchImpl,
    });

    await adapter.setVariantPrice("99", 1299);
    assert.match(calls[0]!.url, /\/v1\/variants\/99$/);
    assert.equal(calls[0]!.init.method, "PATCH");
    const body = JSON.parse(String(calls[0]!.init.body)) as {
      data: { type: string; id: string; attributes: { price: number } };
    };
    assert.equal(body.data.type, "variants");
    assert.equal(body.data.id, "99");
    assert.equal(body.data.attributes.price, 1299);
  });

  it("uploadFile multipart posts to /v1/files with Bearer only", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse({ data: { type: "files", id: "1" } });
    };

    const adapter = createLemonSqueezyAdapter({
      apiKey: "ls-key",
      fetchImpl,
    });

    await adapter.uploadFile("99", Buffer.from("%PDF-1.4"), "planner.pdf");

    assert.equal(calls.length, 1);
    assert.match(calls[0]!.url, /\/v1\/files$/);
    assert.equal(calls[0]!.init.method, "POST");
    const headers = new Headers(calls[0]!.init.headers);
    assert.equal(headers.get("Authorization"), "Bearer ls-key");
    assert.equal(headers.get("Content-Type"), null);
    assert.equal(headers.get("Accept"), null);
    assert.ok(calls[0]!.init.body instanceof FormData);
    const form = calls[0]!.init.body as FormData;
    assert.equal(form.get("file_name"), "planner.pdf");
    assert.equal(form.get("variant_id"), "99");
  });

  it("publishProduct PATCHes status published and reads buy_url", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse({
        data: {
          type: "products",
          id: "42",
          attributes: {
            buy_url: "https://store.lemonsqueezy.com/checkout/buy/abc-123",
          },
        },
      });
    };

    const adapter = createLemonSqueezyAdapter({
      apiKey: "ls-key",
      fetchImpl,
    });

    const result = await adapter.publishProduct("42");

    assert.equal(
      result.buy_now_url,
      "https://store.lemonsqueezy.com/checkout/buy/abc-123",
    );
    assert.match(calls[0]!.url, /\/v1\/products\/42$/);
    assert.equal(calls[0]!.init.method, "PATCH");
    const body = JSON.parse(String(calls[0]!.init.body)) as {
      data: { attributes: { status: string } };
    };
    assert.equal(body.data.attributes.status, "published");
  });

  it("throws LemonSqueezyAdapterError on API failure", async () => {
    const fetchImpl = async (url: string | URL) => {
      if (String(url).endsWith("/v1/stores")) {
        return storesResponse("7");
      }
      return jsonResponse({ errors: [{ detail: "Invalid store" }] }, 422);
    };

    const adapter = createLemonSqueezyAdapter({
      apiKey: "ls-key",
      fetchImpl,
    });

    await assert.rejects(
      () =>
        adapter.createProduct({
          name: "X",
          description: "Y",
        }),
      (err: unknown) => {
        assert.ok(err instanceof LemonSqueezyAdapterError);
        assert.equal(err.statusCode, 422);
        return true;
      },
    );
  });

  it("getDefaultVariant throws when no variants returned", async () => {
    const fetchImpl = async () => jsonResponse({ data: [] });

    const adapter = createLemonSqueezyAdapter({
      apiKey: "ls-key",
      fetchImpl,
    });

    await assert.rejects(
      () => adapter.getDefaultVariant("42"),
      (err: unknown) => {
        assert.ok(err instanceof LemonSqueezyAdapterError);
        assert.match(err.message, /default variant/);
        return true;
      },
    );
  });
});
