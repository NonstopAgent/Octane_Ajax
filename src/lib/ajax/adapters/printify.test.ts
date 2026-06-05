import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createDemoPrintifyAdapter,
  createLivePrintifyAdapter,
} from "@/lib/ajax/adapters/printify";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("printify adapter — submitOrder", () => {
  it("returns demo order in demo mode", async () => {
    const adapter = createDemoPrintifyAdapter();
    const result = await adapter.submitOrder({
      externalId: "etsy-12345",
      lineItems: [
        { productId: "pfy-prod-demo", variantId: 33719, quantity: 1 },
      ],
      shippingAddress: {
        firstName: "Demo",
        lastName: "Customer",
        country: "US",
        address1: "123 Demo St",
        city: "LA",
        zip: "90001",
      },
    });

    assert.equal(result.mode, "demo");
    assert.match(result.data.orderId, /^pfy-ord-/);
    assert.equal(result.data.externalId, "etsy-12345");
  });

  it("posts live fulfillment order to Printify API", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse({ id: "live-order-1", external_id: "etsy-999", status: "pending" });
    }) as typeof fetch;

    const adapter = createLivePrintifyAdapter({
      apiToken: "token",
      shopId: "shop-42",
      fetchImpl,
    });

    const result = await adapter.submitOrder({
      externalId: "etsy-999",
      lineItems: [
        { productId: "prod-abc", variantId: 17887, quantity: 1 },
      ],
      shippingAddress: {
        firstName: "John",
        lastName: "Smith",
        email: "john@example.com",
        country: "US",
        region: "CA",
        address1: "1 Market St",
        city: "San Francisco",
        zip: "94105",
      },
    });

    assert.equal(result.mode, "live");
    assert.equal(result.data.orderId, "live-order-1");
    assert.equal(calls.length, 1);
    assert.match(calls[0]!.url, /\/shops\/shop-42\/orders\.json$/);

    const body = JSON.parse(String(calls[0]!.init.body)) as {
      external_id: string;
      line_items: Array<{ product_id: string; variant_id: number }>;
      address_to: { first_name: string; country: string };
    };
    assert.equal(body.external_id, "etsy-999");
    assert.equal(body.line_items[0]!.product_id, "prod-abc");
    assert.equal(body.address_to.first_name, "John");
    assert.equal(body.address_to.country, "US");
  });
});
