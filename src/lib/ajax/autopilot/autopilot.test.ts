import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  auditListing,
  buildTagFill,
  ETSY_MAX_TAGS,
  type ListingAuditInput,
} from "@/lib/ajax/autopilot/decisions";
import {
  selectTakedownCandidate,
  type TakedownCandidate,
} from "@/lib/ajax/autopilot/takedown";

function healthyListing(): ListingAuditInput {
  return {
    etsyListingId: "123",
    title: "Adopted & Loved Rescue Dog Poster",
    tagCount: 13,
    usShippingCostCents: 0,
    hasReturnPolicy: true,
    priceCents: 2799,
    minPriceCents: 2799,
    totalViews: 40,
    ageDays: 10,
    hasRecentMarketing: true,
  };
}

describe("auditListing", () => {
  it("does nothing for a healthy listing", () => {
    assert.deepEqual(auditListing(healthyListing()), []);
  });

  it("fills missing tags automatically", () => {
    const actions = auditListing({ ...healthyListing(), tagCount: 7 });
    assert.ok(actions.some((a) => a.kind === "fill_tags"));
  });

  it("fixes paid US shipping automatically", () => {
    const actions = auditListing({
      ...healthyListing(),
      usShippingCostCents: 759,
    });
    assert.ok(actions.some((a) => a.kind === "fix_shipping"));
  });

  it("recommends (not auto-creates) a return policy", () => {
    const actions = auditListing({
      ...healthyListing(),
      hasReturnPolicy: false,
    });
    const rec = actions.find((a) => a.kind === "recommend");
    assert.ok(rec && rec.kind === "recommend");
    assert.match(rec.title, /return policy/i);
  });

  it("queues underpricing as a recommendation, never an auto-fix", () => {
    const actions = auditListing({
      ...healthyListing(),
      priceCents: 1999,
      minPriceCents: 2799,
    });
    const rec = actions.find(
      (a) => a.kind === "recommend" && a.category === "pricing",
    );
    assert.ok(rec, "expected a pricing recommendation");
    assert.ok(!actions.some((a) => a.kind === "fill_tags"));
  });

  it("pushes marketing for stalled listings past the grace period", () => {
    const actions = auditListing({
      ...healthyListing(),
      totalViews: 1,
      ageDays: 4,
      hasRecentMarketing: false,
    });
    assert.ok(actions.some((a) => a.kind === "queue_marketing"));
  });

  it("gives new listings a traffic grace period", () => {
    const actions = auditListing({
      ...healthyListing(),
      totalViews: 0,
      ageDays: 1,
      hasRecentMarketing: false,
    });
    assert.ok(!actions.some((a) => a.kind === "queue_marketing"));
  });
});

describe("buildTagFill", () => {
  it("keeps existing tags first, dedupes, and caps at 13", () => {
    const tags = buildTagFill(
      ["rescue dog gift", "dog mom gift"],
      [
        "Rescue Dog Gift", // dupe (case)
        "pet memorial",
        "dog memorial gift",
        "custom pet portrait",
        "animal wall art",
        "dog dad gift",
        "dog painting",
        "dog wall art",
        "adoption day gift",
        "adopt dont shop",
        "gotcha day gift",
        "dog art print",
        "extra tag beyond cap",
      ],
    );
    assert.equal(tags.length, ETSY_MAX_TAGS);
    assert.equal(tags[0], "rescue dog gift");
    assert.ok(!tags.includes("extra tag beyond cap"));
  });

  it("drops tags over Etsy's 20-char limit", () => {
    const tags = buildTagFill([], ["this tag is definitely way too long", "ok tag"]);
    assert.deepEqual(tags, ["ok tag"]);
  });
});

function candidate(over: Partial<TakedownCandidate> = {}): TakedownCandidate {
  return {
    listingId: "l1",
    title: "Dead Weight Mug",
    printifyProductId: "pfy-1",
    ageDays: 40,
    views: 3,
    orders: 0,
    revenueCents: 0,
    ...over,
  };
}

describe("selectTakedownCandidate", () => {
  it("never retires a listing that has sold, even at capacity", () => {
    const seller = candidate({ orders: 2, views: 1, ageDays: 90 });
    assert.equal(selectTakedownCandidate([seller], { atCapacity: true }), null);
    const earner = candidate({ revenueCents: 2499, views: 1, ageDays: 90 });
    assert.equal(selectTakedownCandidate([earner], { atCapacity: true }), null);
  });

  it("never retires a listing younger than the min age", () => {
    const young = candidate({ ageDays: 10, views: 0 });
    assert.equal(selectTakedownCandidate([young], { atCapacity: true }), null);
  });

  it("at capacity, prunes the weakest non-seller (fewest views)", () => {
    const a = candidate({ listingId: "a", views: 18, ageDays: 35 });
    const b = candidate({ listingId: "b", views: 2, ageDays: 35 });
    const picked = selectTakedownCandidate([a, b], { atCapacity: true });
    assert.equal(picked?.listingId, "b");
  });

  it("under capacity, only retires egregiously dead listings", () => {
    // 33 days, 12 views: dead-ish but not egregious → keep when under capacity.
    const mild = candidate({ ageDays: 33, views: 12 });
    assert.equal(selectTakedownCandidate([mild], { atCapacity: false }), null);
    // 60 days, 1 view → egregious → retire.
    const dead = candidate({ ageDays: 60, views: 1 });
    assert.equal(
      selectTakedownCandidate([dead], { atCapacity: false })?.listingId,
      "l1",
    );
  });

  it("holds at capacity when every listing is performing", () => {
    const strong = candidate({ views: 200, ageDays: 40 });
    assert.equal(selectTakedownCandidate([strong], { atCapacity: true }), null);
  });
});
