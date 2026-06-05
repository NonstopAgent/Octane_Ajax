import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ORDER_QUEUE_STATUSES,
  assertOrderStatusTransition,
  blockInfringingTerms,
  canTransitionOrderStatus,
  extractPersonalizationFromWebhook,
  isValidCustomerPhotoUrl,
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
  it("defines four order queue statuses", () => {
    assert.deepEqual(ORDER_QUEUE_STATUSES, [
      "pending_personalization",
      "processing_artwork",
      "fulfillment_ready",
      "failed",
    ]);
  });

  it("allows pending → processing → fulfillment_ready", () => {
    assert.equal(
      canTransitionOrderStatus("pending_personalization", "processing_artwork"),
      true,
    );
    assert.equal(
      canTransitionOrderStatus("processing_artwork", "fulfillment_ready"),
      true,
    );
    assert.doesNotThrow(() => {
      assertOrderStatusTransition("pending_personalization", "processing_artwork");
      assertOrderStatusTransition("processing_artwork", "fulfillment_ready");
    });
  });

  it("allows failure from pending or processing", () => {
    assert.equal(
      canTransitionOrderStatus("pending_personalization", "failed"),
      true,
    );
    assert.equal(canTransitionOrderStatus("processing_artwork", "failed"), true);
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
      assertOrderStatusTransition("fulfillment_ready", "failed");
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
});
