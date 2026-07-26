import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  auditListing,
  buildTagFill,
  ETSY_MAX_TAGS,
  rotatingBatch,
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

describe("rotatingBatch", () => {
  const shop = (n: number) => Array.from({ length: n }, (_, i) => i);

  it("returns everything when the list fits in one pass", () => {
    assert.deepEqual(rotatingBatch(shop(9), 25, 0), shop(9));
    assert.deepEqual(rotatingBatch(shop(25), 25, 7), shop(25));
  });

  it("advances the window each hour instead of re-auditing the head", () => {
    const first = rotatingBatch(shop(35), 25, 0);
    const second = rotatingBatch(shop(35), 25, 1);
    assert.equal(first[0], 0);
    assert.equal(second[0], 25);
    assert.notDeepEqual(first, second);
  });

  it("covers every listing across a full rotation (the M2 regression)", () => {
    // 35 live listings, 25 per pass: the old slice(0, 25) never reached 25-34.
    const seen = new Set<number>();
    for (let hour = 0; hour < 24; hour += 1) {
      for (const id of rotatingBatch(shop(35), 25, hour)) seen.add(id);
    }
    assert.equal(seen.size, 35);
  });

  it("covers every listing for shop sizes well past the cap", () => {
    for (const size of [26, 30, 49, 50, 51, 100]) {
      const seen = new Set<number>();
      for (let hour = 0; hour < 24; hour += 1) {
        for (const id of rotatingBatch(shop(size), 25, hour)) seen.add(id);
      }
      assert.equal(seen.size, size, `shop of ${size} left listings unaudited`);
    }
  });

  it("keeps every pass the same width and never repeats within a pass", () => {
    const batch = rotatingBatch(shop(30), 25, 1);
    assert.equal(batch.length, 25);
    assert.equal(new Set(batch).size, 25);
  });

  it("is stable for a given hour and tolerates a negative hour", () => {
    assert.deepEqual(
      rotatingBatch(shop(35), 25, 3),
      rotatingBatch(shop(35), 25, 3),
    );
    assert.deepEqual(
      rotatingBatch(shop(35), 25, -1),
      rotatingBatch(shop(35), 25, 1),
    );
  });

  it("returns nothing for a non-positive batch size", () => {
    assert.deepEqual(rotatingBatch(shop(10), 0, 4), []);
  });
});
