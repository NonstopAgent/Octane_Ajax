import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cameraLabelFromSrc,
  createDemoPrintifyAdapter,
  createLivePrintifyAdapter,
  selectMockupsForPublishing,
  MAX_PUBLISH_MOCKUPS,
  type PrintifyProductImage,
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

function mockupImage(
  label: string,
  overrides: Partial<PrintifyProductImage> = {},
): PrintifyProductImage {
  return {
    src: `https://images.printify.com/mockup/p1/v1/${label}.png?camera_label=${label}`,
    variant_ids: [67624],
    position: "other",
    is_default: false,
    is_selected_for_publishing: false,
    ...overrides,
  };
}

describe("printify adapter — mockup selection", () => {
  it("extracts camera labels from mockup URLs", () => {
    assert.equal(
      cameraLabelFromSrc(
        "https://images.printify.com/mockup/x/1/2/mug.png?camera_label=context-1&foo=1",
      ),
      "context-1",
    );
    assert.equal(cameraLabelFromSrc("https://example.com/no-label.png"), null);
  });

  it("returns null when there is nothing to select (0 or 1 image)", () => {
    assert.equal(selectMockupsForPublishing([]), null);
    assert.equal(
      selectMockupsForPublishing([mockupImage("front", { is_default: true })]),
      null,
    );
  });

  it("selects one image per camera angle, best angles first, capped at max", () => {
    const images = [
      mockupImage("back"),
      mockupImage("front", { is_default: true, is_selected_for_publishing: true }),
      mockupImage("front"), // duplicate angle — must not double-select
      mockupImage("context-1"),
      mockupImage("context-2"),
      mockupImage("left"),
      mockupImage("right"),
      mockupImage("context-3"),
      mockupImage("flat-lay"),
      mockupImage("hanging"),
      mockupImage("lifestyle"),
    ];

    const result = selectMockupsForPublishing(images);
    assert.ok(result, "selection should change the flags");
    const selected = result!.filter((i) => i.is_selected_for_publishing);
    assert.ok(selected.length >= 5, `expected 5+ selected, got ${selected.length}`);
    assert.ok(selected.length <= MAX_PUBLISH_MOCKUPS);
    // Result keeps the full array shape for the PUT body.
    assert.equal(result!.length, images.length);
    // Exactly one default, and it is a selected image.
    const defaults = result!.filter((i) => i.is_default);
    assert.equal(defaults.length, 1);
    assert.equal(defaults[0]!.is_selected_for_publishing, true);
    // The duplicate front angle is not selected twice.
    const selectedFront = selected.filter(
      (i) => cameraLabelFromSrc(i.src) === "front",
    );
    assert.equal(selectedFront.length, 1);
  });

  it("keeps the existing default when it remains selected", () => {
    const images = [
      mockupImage("context-1", { is_default: true, is_selected_for_publishing: true }),
      mockupImage("front"),
      mockupImage("left"),
    ];
    const result = selectMockupsForPublishing(images);
    assert.ok(result);
    const def = result!.find((i) => i.is_default);
    assert.equal(cameraLabelFromSrc(def!.src), "context-1");
  });

  it("returns null when the selection already matches", () => {
    const images = [
      mockupImage("front", { is_default: true, is_selected_for_publishing: true }),
      mockupImage("context-1", { is_selected_for_publishing: true }),
      mockupImage("left", { is_selected_for_publishing: true }),
    ];
    assert.equal(selectMockupsForPublishing(images), null);
  });
});

describe("printify adapter — publishProduct mockup gallery", () => {
  const productImages = [
    mockupImage("front", { is_default: true, is_selected_for_publishing: true }),
    mockupImage("left"),
    mockupImage("right"),
    mockupImage("context-1"),
    mockupImage("context-2"),
    mockupImage("context-3"),
  ];

  it("selects mockups (GET → PUT) before publishing", async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url: String(url), method, body: init?.body as string });
      if (method === "GET") {
        return jsonResponse({ id: "prod-1", images: productImages });
      }
      return jsonResponse({ ok: true });
    }) as typeof fetch;

    const adapter = createLivePrintifyAdapter({
      apiToken: "token",
      shopId: "shop-42",
      fetchImpl,
    });

    const result = await adapter.publishProduct("prod-1");
    assert.equal(result.data.status, "published");

    assert.equal(calls.length, 4);
    assert.match(calls[0]!.url, /\/products\/prod-1\.json$/);
    assert.equal(calls[0]!.method, "GET");
    assert.match(calls[1]!.url, /\/products\/prod-1\.json$/);
    assert.equal(calls[1]!.method, "PUT");
    assert.match(calls[2]!.url, /\/products\/prod-1\/publish\.json$/);
    assert.match(calls[3]!.url, /\/products\/prod-1\/publishing_succeeded\.json$/);

    const putBody = JSON.parse(calls[1]!.body!) as {
      images: PrintifyProductImage[];
    };
    assert.equal(putBody.images.length, productImages.length);
    const selectedCount = putBody.images.filter(
      (i) => i.is_selected_for_publishing,
    ).length;
    assert.ok(selectedCount >= 5, `expected 5+ selected, got ${selectedCount}`);
  });

  it("still publishes when the mockup lookup fails (fail-open)", async () => {
    const calls: { url: string; method: string }[] = [];
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url: String(url), method });
      if (method === "GET") {
        return jsonResponse({ error: "boom" }, 500);
      }
      return jsonResponse({ ok: true });
    }) as typeof fetch;

    const adapter = createLivePrintifyAdapter({
      apiToken: "token",
      shopId: "shop-42",
      fetchImpl,
    });

    const result = await adapter.publishProduct("prod-2");
    assert.equal(result.data.status, "published");
    // GET failed → no PUT; publish continues.
    assert.equal(
      calls.some((c) => c.method === "PUT"),
      false,
    );
    assert.ok(calls.some((c) => /\/publish\.json$/.test(c.url)));
    assert.ok(calls.some((c) => /publishing_succeeded\.json$/.test(c.url)));
  });
});
