import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LISTING_STATUS_TRANSITIONS,
  LISTING_STATUSES,
  REVIEW_STATUS_TRANSITIONS,
  isListingStatus,
} from "@/lib/ajax/status";
import type { ListingStatus } from "@/lib/ajax/status";

function canTransitionListing(
  from: ListingStatus,
  to: ListingStatus,
): boolean {
  return LISTING_STATUS_TRANSITIONS[from].includes(to);
}

describe("listing publish transitions", () => {
  it("exposes all listing statuses including published", () => {
    assert.ok(LISTING_STATUSES.includes("published"));
    assert.ok(LISTING_STATUSES.includes("approved"));
    assert.ok(isListingStatus("published"));
    assert.equal(isListingStatus("live"), false);
  });

  it("ends published and rejected states with no outbound edges", () => {
    assert.deepEqual(LISTING_STATUS_TRANSITIONS.published, []);
    assert.deepEqual(LISTING_STATUS_TRANSITIONS.rejected, []);
  });

  it("requires human review before publish (no skip to published)", () => {
    assert.ok(!canTransitionListing("pending_review", "published"));
    assert.ok(!canTransitionListing("draft", "published"));
    assert.ok(!canTransitionListing("draft", "approved"));
  });

  it("allows demo path Forge → review → approve → Pixel → storefront", () => {
    const path: ListingStatus[] = [
      "draft",
      "pending_review",
      "approved",
      "published",
    ];
    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i]!;
      const to = path[i + 1]!;
      assert.ok(
        canTransitionListing(from, to),
        `expected ${from} → ${to}`,
      );
    }
  });

  it("allows reject from pending_review only", () => {
    assert.ok(canTransitionListing("pending_review", "rejected"));
    assert.ok(!canTransitionListing("approved", "rejected"));
  });
});

describe("review gate transitions", () => {
  it("locks review after approve or reject", () => {
    assert.deepEqual(REVIEW_STATUS_TRANSITIONS.approved, []);
    assert.deepEqual(REVIEW_STATUS_TRANSITIONS.rejected, []);
    assert.deepEqual(REVIEW_STATUS_TRANSITIONS.pending, [
      "approved",
      "rejected",
    ]);
  });
});
