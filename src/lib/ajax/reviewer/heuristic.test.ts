import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { heuristicReview } from "@/lib/ajax/reviewer/heuristic";

const TAGS = Array.from({ length: 13 }, (_, i) => `rescue dog mom tag ${i}`);

describe("heuristicReview", () => {
  it("always returns all five subscores", () => {
    const r = heuristicReview({ title: "x", mockupUrls: [] });
    for (const k of ["seo", "sellability", "brand", "quality", "compliance"] as const) {
      assert.equal(typeof r.subscores[k], "number");
    }
  });

  it("scores a complete, personalized, occasion listing well", () => {
    const r = heuristicReview({
      title: "Personalized Rescue Dog Mom Gotcha Day Mug",
      description:
        "A heartfelt personalized keepsake for the rescue dog mom celebrating her pup's gotcha day. Add their name and sip your morning coffee in style. Made to order and shipped fast.",
      price: 24,
      tags: TAGS,
      mockupUrls: ["https://img.example.com/mock.jpg"],
    });
    assert.equal(r.hardBlock, false);
    assert.equal(r.subscores.compliance, 100);
    assert.ok(r.subscores.sellability >= 70);
    assert.ok(r.subscores.quality >= 90);
  });

  it("drops quality when the mockup and description are missing", () => {
    const r = heuristicReview({
      title: "Dog Mug",
      description: null,
      mockupUrls: [],
    });
    assert.ok(r.subscores.quality < 70);
    assert.ok(r.fixes.some((f) => /mockup/i.test(f)));
  });

  it("penalizes brand fit when the listing is off the store niche", () => {
    const onNiche = heuristicReview({
      title: "Rescue Dog Mom Mug",
      mockupUrls: [],
      storeNiche: "gifts for rescue dog moms",
    });
    const offNiche = heuristicReview({
      title: "Vintage Car Enthusiast Mug",
      mockupUrls: [],
      storeNiche: "gifts for rescue dog moms",
    });
    assert.ok(offNiche.subscores.brand < onNiche.subscores.brand);
  });

  it("penalizes sellability for a saturated niche", () => {
    const base = {
      title: "Personalized Dog Mom Gotcha Day Mug",
      mockupUrls: [] as string[],
    };
    const open = heuristicReview({
      ...base,
      market: { searchesPerMonth: 1200, competingListings: 800, matchedTerm: "x" },
    });
    const saturated = heuristicReview({
      ...base,
      market: {
        searchesPerMonth: 300,
        competingListings: 250000,
        matchedTerm: "x",
      },
    });
    assert.ok(saturated.subscores.sellability < open.subscores.sellability);
    assert.ok(saturated.fixes.some((f) => /saturat/i.test(f)));
  });
});
