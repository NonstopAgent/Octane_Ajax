import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createGumroadAdapter,
  GumroadAdapterError,
  listingPriceToCents,
} from "@/lib/ajax/adapters/gumroad";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("gumroad adapter", () => {
  it("maps listing price to cents with default", () => {
    assert.equal(listingPriceToCents(null), 799);
    assert.equal(listingPriceToCents(12.99), 1299);
    assert.equal(listingPriceToCents(0.5), 100);
  });

  it("createProduct posts form body with Bearer auth", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse({
        success: true,
        product: {
          id: "prod_abc",
          short_url: "https://shop.gumroad.com/l/planner",
        },
      });
    }) as typeof fetch;

    const adapter = createGumroadAdapter({
      accessToken: "test-token",
      fetchImpl,
    });

    const result = await adapter.createProduct({
      name: "Planner",
      description: "Weekly planner PDF",
      price_cents: 1299,
      published: false,
    });

    assert.equal(result.product_id, "prod_abc");
    assert.equal(result.short_url, "https://shop.gumroad.com/l/planner");
    assert.equal(calls.length, 1);
    assert.match(calls[0]!.url, /\/v2\/products$/);
    assert.equal(calls[0]!.init.method, "POST");
    const headers = new Headers(calls[0]!.init.headers);
    assert.equal(headers.get("Authorization"), "Bearer test-token");
    const body = String(calls[0]!.init.body);
    assert.match(body, /name=Planner/);
    assert.match(body, /price=1299/);
    assert.match(body, /published=false/);
  });

  it("uploadProductFile multipart posts to product files endpoint", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse({ success: true });
    }) as typeof fetch;

    const adapter = createGumroadAdapter({
      accessToken: "test-token",
      fetchImpl,
    });

    await adapter.uploadProductFile(
      "prod_abc",
      Buffer.from("%PDF-1.4"),
      "planner.pdf",
    );

    assert.equal(calls.length, 1);
    assert.match(calls[0]!.url, /\/products\/prod_abc\/files$/);
    assert.equal(calls[0]!.init.method, "POST");
    const headers = new Headers(calls[0]!.init.headers);
    assert.equal(headers.get("Authorization"), "Bearer test-token");
    assert.ok(calls[0]!.init.body instanceof FormData);
  });

  it("publishProduct PUTs published=true", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse({ success: true, product: { id: "prod_abc" } });
    };

    const adapter = createGumroadAdapter({
      accessToken: "test-token",
      fetchImpl,
    });

    await adapter.publishProduct("prod_abc");

    assert.equal(calls.length, 1);
    assert.match(calls[0]!.url, /\/products\/prod_abc$/);
    assert.equal(calls[0]!.init.method, "PUT");
    assert.match(String(calls[0]!.init.body), /published=true/);
  });

  it("throws GumroadAdapterError on API failure", async () => {
    const fetchImpl = async () =>
      jsonResponse({ success: false, message: "Nope" }, 422);

    const adapter = createGumroadAdapter({
      accessToken: "test-token",
      fetchImpl,
    });

    await assert.rejects(
      () =>
        adapter.createProduct({
          name: "X",
          description: "Y",
          price_cents: 100,
        }),
      (err: unknown) => {
        assert.ok(err instanceof GumroadAdapterError);
        assert.equal(err.statusCode, 422);
        return true;
      },
    );
  });
});
