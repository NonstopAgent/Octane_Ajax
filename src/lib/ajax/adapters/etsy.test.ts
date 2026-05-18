import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createEtsyAdapter,
  EtsyAdapterError,
  ETSY_DIGITAL_TAXONOMY_ID,
} from "@/lib/ajax/adapters/etsy";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("etsy adapter", () => {
  it("createDraftListing posts urlencoded body with Etsy headers", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse({ listing_id: 999001, url: "https://www.etsy.com/listing/999001" });
    };

    const adapter = createEtsyAdapter({ clientId: "etsy-key", fetchImpl });
    const result = await adapter.createDraftListing({
      title: "Meal Prep Planner",
      description: "Printable planner PDF",
      price_cents: 799,
      tags: ["planner", "meal prep"],
      shopId: "12345",
      accessToken: "42.token-value",
    });

    assert.equal(result.listing_id, "999001");
    assert.equal(result.url, "https://www.etsy.com/listing/999001");
    assert.equal(calls.length, 1);
    assert.match(calls[0]!.url, /\/shops\/12345\/listings$/);
    const headers = new Headers(calls[0]!.init.headers);
    assert.equal(headers.get("x-api-key"), "etsy-key");
    assert.equal(headers.get("Authorization"), "Bearer 42.token-value");
    const body = String(calls[0]!.init.body);
    assert.match(body, /title=Meal\+Prep\+Planner/);
    assert.match(body, /price=799/);
    assert.match(body, new RegExp(`taxonomy_id=${ETSY_DIGITAL_TAXONOMY_ID}`));
    assert.match(body, /type=download/);
    assert.match(body, /state=active/);
    assert.match(body, /tags%5B%5D=planner/);
  });

  it("uploadListingFile multipart posts PDF to files endpoint", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response("", { status: 200 });
    };

    const adapter = createEtsyAdapter({ clientId: "etsy-key", fetchImpl });
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
    assert.equal(headers.get("x-api-key"), "etsy-key");
    assert.equal(headers.get("Authorization"), "Bearer 42.token-value");
  });

  it("throws EtsyAdapterError on API failure", async () => {
    const fetchImpl = async () =>
      jsonResponse({ error: "Invalid taxonomy" }, 400);

    const adapter = createEtsyAdapter({ clientId: "etsy-key", fetchImpl });

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
