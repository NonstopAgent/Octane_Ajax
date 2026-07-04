import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEtsyAdapter, EtsyAdapterError } from "@/lib/ajax/adapters/etsy";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("etsy adapter", () => {
  it("createDraftListing posts urlencoded body with Etsy headers", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse({ listing_id: 999001, url: "https://www.etsy.com/listing/999001" });
    }) as typeof fetch;

    const adapter = createEtsyAdapter({ clientId: "etsy-key", sharedSecret: "etsy-secret", fetchImpl });
    const result = await adapter.createDraftListing({
      title: "Meal Prep Planner",
      description: "Printable planner PDF",
      price_cents: 799,
      taxonomy_id: 1234,
      // Provided explicitly so the adapter skips the shipping/return lookups.
      shipping_profile_id: 555,
      return_policy_id: 777,
      tags: ["planner", "meal prep"],
      shopId: "12345",
      accessToken: "42.token-value",
    });

    assert.equal(result.listing_id, "999001");
    assert.equal(result.url, "https://www.etsy.com/listing/999001");
    assert.equal(calls.length, 1);
    assert.match(calls[0]!.url, /\/shops\/12345\/listings$/);
    const headers = new Headers(calls[0]!.init.headers);
    assert.equal(headers.get("x-api-key"), "etsy-key:etsy-secret");
    assert.equal(headers.get("Authorization"), "Bearer 42.token-value");
    const body = String(calls[0]!.init.body);
    assert.match(body, /title=Meal\+Prep\+Planner/);
    assert.match(body, /price=7\.99/);
    assert.match(body, /when_made=2020_2026/);
    assert.match(body, /who_made=someone_else/);
    assert.match(body, /taxonomy_id=1234/);
    assert.match(body, /shipping_profile_id=555/);
    assert.match(body, /return_policy_id=777/);
    assert.match(body, /type=physical/);
    assert.match(body, /state=draft/);
    assert.match(body, /tags%5B%5D=planner/);
  });

  it("uploadListingImage multipart posts JPEG to images endpoint", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse({ listing_image_id: 555001 });
    }) as typeof fetch;

    const adapter = createEtsyAdapter({ clientId: "etsy-key", sharedSecret: "etsy-secret", fetchImpl });
    const result = await adapter.uploadListingImage(
      "999001",
      Buffer.from([0xff, 0xd8, 0xff]),
      "cover.jpg",
      "12345",
      "42.token-value",
      1,
    );

    assert.equal(result.listing_image_id, "555001");
    assert.equal(calls.length, 1);
    assert.match(calls[0]!.url, /\/shops\/12345\/listings\/999001\/images$/);
    assert.ok(calls[0]!.init.body instanceof FormData);
    const headers = new Headers(calls[0]!.init.headers);
    assert.equal(headers.get("x-api-key"), "etsy-key:etsy-secret");
    assert.equal(headers.get("Authorization"), "Bearer 42.token-value");
    assert.equal(headers.get("Content-Type"), null);
  });

  it("uploadListingVideo multipart posts MP4 to videos endpoint", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse({ listing_video_id: 777002 });
    }) as typeof fetch;

    const adapter = createEtsyAdapter({ clientId: "etsy-key", sharedSecret: "etsy-secret", fetchImpl });
    const result = await adapter.uploadListingVideo(
      "999001",
      Buffer.from([0x00, 0x00, 0x00]),
      "clip.mp4",
      "12345",
      "42.token-value",
      "product video",
    );

    assert.equal(result.listing_video_id, "777002");
    assert.match(calls[0]!.url, /\/shops\/12345\/listings\/999001\/videos$/);
    assert.ok(calls[0]!.init.body instanceof FormData);
    const headers = new Headers(calls[0]!.init.headers);
    assert.equal(headers.get("x-api-key"), "etsy-key:etsy-secret");
    assert.equal(headers.get("Authorization"), "Bearer 42.token-value");
  });

  it("uploadListingFile multipart posts PDF to files endpoint", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response("", { status: 200 });
    }) as typeof fetch;

    const adapter = createEtsyAdapter({ clientId: "etsy-key", sharedSecret: "etsy-secret", fetchImpl });
    await adapter.uploadListingFile(
      "999001",
      Buffer.from("%PDF-1.4"),
      "planner.pdf",
      "12345",
      "42.token-value",
    );

    assert.equal(calls.length, 1);
    assert.match(calls[0]!.url, /\/shops\/12345\/listings\/999001\/files$/);
    assert.ok(calls[0]!.init.body instanceof FormData);
    const headers = new Headers(calls[0]!.init.headers);
    assert.equal(headers.get("x-api-key"), "etsy-key:etsy-secret");
    assert.equal(headers.get("Authorization"), "Bearer 42.token-value");
  });

  it("throws EtsyAdapterError on API failure", async () => {
    const fetchImpl = async () =>
      jsonResponse({ error: "Invalid taxonomy" }, 400);

    const adapter = createEtsyAdapter({ clientId: "etsy-key", sharedSecret: "etsy-secret", fetchImpl });

    await assert.rejects(
      () =>
        adapter.createDraftListing({
          title: "X",
          description: "Y",
          price_cents: 100,
          shopId: "1",
          accessToken: "1.token",
        }),
      (err: unknown) => {
        assert.ok(err instanceof EtsyAdapterError);
        assert.equal(err.statusCode, 400);
        return true;
      },
    );
  });
});
