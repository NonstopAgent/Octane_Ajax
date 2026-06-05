import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ORDER_QUEUE_STATUSES,
  assertOrderStatusTransition,
  blockInfringingTerms,
  canTransitionOrderStatus,
  extractPersonalizationFromWebhook,
  extractShippingFromWebhook,
  isValidCustomerPhotoUrl,
  normalizeEtsyWebhookPayload,
  sanitizeStylePrompt,
} from "@/lib/ajax/pod/order-types";

describe("order-types IP guardrails", () => {
  it("blocks copyrighted franchise terms", () => {
    const result = blockInfringingTerms("Make it look like The Simpsons");
    assert.equal(result.blocked, true);
    assert.ok(result.terms.includes("simpsons"));
  });

  it("blocks marvel and superhero references in style prompts", () => {
    const result = sanitizeStylePrompt("Marvel superhero watercolor");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.blockedTerms?.includes("marvel"));
    }
  });

  it("rewrites watercolor preset into original art prompt", () => {
    const result = sanitizeStylePrompt("watercolor");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.preset, "watercolor");
      assert.match(result.prompt, /watercolor/i);
      assert.match(result.prompt, /original artwork/i);
    }
  });

  it("rewrites renaissance, line-art, and pop-art presets", () => {
    for (const preset of ["renaissance", "line-art", "pop-art"] as const) {
      const result = sanitizeStylePrompt(preset);
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.preset, preset);
      }
    }
  });

  it("sanitizes custom styles without infringing terms", () => {
    const result = sanitizeStylePrompt("soft pastel sketch");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.match(result.prompt, /no logos/i);
    }
  });

  it("rejects empty style preference", () => {
    const result = sanitizeStylePrompt("   ");
    assert.equal(result.ok, false);
  });
});

describe("order-types state machine", () => {
  it("defines five order queue statuses", () => {
    assert.deepEqual(ORDER_QUEUE_STATUSES, [
      "pending_personalization",
      "processing_artwork",
      "fulfillment_ready",
      "production_submitted",
      "failed",
    ]);
  });

  it("allows pending → processing → fulfillment_ready → production_submitted", () => {
    assert.equal(
      canTransitionOrderStatus("pending_personalization", "processing_artwork"),
      true,
    );
    assert.equal(
      canTransitionOrderStatus("processing_artwork", "fulfillment_ready"),
      true,
    );
    assert.equal(
      canTransitionOrderStatus("fulfillment_ready", "production_submitted"),
      true,
    );
    assert.doesNotThrow(() => {
      assertOrderStatusTransition("pending_personalization", "processing_artwork");
      assertOrderStatusTransition("processing_artwork", "fulfillment_ready");
      assertOrderStatusTransition("fulfillment_ready", "production_submitted");
    });
  });

  it("allows failure from pending, processing, or fulfillment_ready", () => {
    assert.equal(
      canTransitionOrderStatus("pending_personalization", "failed"),
      true,
    );
    assert.equal(canTransitionOrderStatus("processing_artwork", "failed"), true);
    assert.equal(canTransitionOrderStatus("fulfillment_ready", "failed"), true);
  });

  it("blocks invalid transitions", () => {
    assert.equal(
      canTransitionOrderStatus("pending_personalization", "fulfillment_ready"),
      false,
    );
    assert.equal(
      canTransitionOrderStatus("fulfillment_ready", "processing_artwork"),
      false,
    );
    assert.throws(() => {
      assertOrderStatusTransition("production_submitted", "failed");
    }, /Invalid order status transition/);
  });
});

describe("order-types webhook extraction", () => {
  it("extracts personalization fields from mock Etsy payload", () => {
    const extracted = extractPersonalizationFromWebhook({
      receipt_id: "987654",
      listing_id: "111222",
      personalization: {
        photo_url: "https://example.com/customer.jpg",
        style: "watercolor",
      },
    });

    assert.equal(extracted.etsyOrderId, "987654");
    assert.equal(extracted.listingId, "111222");
    assert.equal(extracted.customerPhotoUrl, "https://example.com/customer.jpg");
    assert.equal(extracted.rawStyle, "watercolor");
  });

  it("falls back to transaction variations for photo and style", () => {
    const extracted = extractPersonalizationFromWebhook({
      order_id: "555",
      transactions: [
        {
          listing_id: "777",
          variations: [
            { formatted_name: "Upload Photo", formatted_value: "demo://photo.png" },
            { formatted_name: "Art Style", formatted_value: "pop-art" },
          ],
        },
      ],
    });

    assert.equal(extracted.etsyOrderId, "555");
    assert.equal(extracted.listingId, "777");
    assert.equal(extracted.customerPhotoUrl, "demo://photo.png");
    assert.equal(extracted.rawStyle, "pop-art");
  });

  it("accepts demo photo URLs for scaffold mode", () => {
    assert.equal(isValidCustomerPhotoUrl("demo://octane-ajax/photos/test.png"), true);
    assert.equal(isValidCustomerPhotoUrl("not-a-url"), false);
  });

  it("extracts personalization from live Etsy receipt transaction variations", () => {
    const extracted = extractPersonalizationFromWebhook({
      receipt_id: 2847392011,
      buyer_email: "buyer@example.com",
      name: "Jane Doe",
      first_line: "42 Oak Ave",
      city: "Portland",
      state: "OR",
      zip: "97201",
      country_iso: "US",
      transactions: [
        {
          listing_id: 1884455667,
          quantity: 2,
          variations: [
            {
              formatted_name: "Customer Photo Upload",
              formatted_value: "https://cdn.etsy.com/uploads/photo.jpg",
            },
            {
              formatted_name: "Choose Art Style",
              formatted_value: "renaissance",
            },
          ],
        },
      ],
    });

    assert.equal(extracted.etsyOrderId, "2847392011");
    assert.equal(extracted.listingId, "1884455667");
    assert.equal(extracted.quantity, 2);
    assert.equal(
      extracted.customerPhotoUrl,
      "https://cdn.etsy.com/uploads/photo.jpg",
    );
    assert.equal(extracted.rawStyle, "renaissance");
  });

  it("unwraps nested Etsy event envelopes", () => {
    const normalized = normalizeEtsyWebhookPayload({
      data: {
        receipt_id: 1001,
        personalization: {
          photo_url: "demo://nested.png",
          style: "watercolor",
        },
      },
    });

    assert.equal(normalized.receipt_id, 1001);
    const extracted = extractPersonalizationFromWebhook(normalized);
    assert.equal(extracted.customerPhotoUrl, "demo://nested.png");
  });

  it("extracts shipping from Etsy receipt fields", () => {
    const shipping = extractShippingFromWebhook({
      receipt_id: 999,
      buyer_email: "ship@example.com",
      name: "Alex Rivera",
      first_line: "10 Main St",
      second_line: "Apt 4",
      city: "Austin",
      state: "TX",
      zip: "78701",
      country_iso: "US",
    });

    assert.ok(shipping);
    assert.equal(shipping!.firstName, "Alex");
    assert.equal(shipping!.lastName, "Rivera");
    assert.equal(shipping!.email, "ship@example.com");
    assert.equal(shipping!.address1, "10 Main St");
    assert.equal(shipping!.city, "Austin");
    assert.equal(shipping!.country, "US");
  });
});
