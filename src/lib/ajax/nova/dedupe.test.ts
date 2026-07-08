import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  filterRepetitiveIdeas,
  isTooSimilar,
  textSimilarity,
} from "@/lib/ajax/nova/dedupe";

describe("textSimilarity", () => {
  it("scores identical concepts as 1 even with different run suffixes", () => {
    const a = "Reactive Rescue Dog Mom T-Shirt Celebrating Training Wins — a1b2c3d4";
    const b = "Reactive Rescue Dog Mom T-Shirt Celebrating Training Wins — 99ffee00";
    assert.equal(textSimilarity(a, b), 1);
  });

  it("scores unrelated concepts low", () => {
    const a = "Senior Cat Memorial Watercolor Poster";
    const b = "Reactive Rescue Dog Mom Training T-Shirt";
    assert.ok(textSimilarity(a, b) < 0.5);
  });

  it("ignores plural/singular differences", () => {
    assert.equal(
      textSimilarity("rescue dog mom mugs", "rescue dog mom mug"),
      1,
    );
  });

  it("returns 0 for empty strings", () => {
    assert.equal(textSimilarity("", "anything"), 0);
  });
});

describe("filterRepetitiveIdeas", () => {
  const idea = (niche: string, productConcept: string) => ({
    niche,
    productConcept,
  });

  it("keeps everything when there is no history", () => {
    const ideas = [
      idea("senior dog adoption gifts", "Senior Dog Mom Mug"),
      idea("gotcha day keepsakes", "Personalized Gotcha Day Poster"),
    ];
    const { kept, dropped } = filterRepetitiveIdeas(ideas, undefined);
    assert.equal(kept.length, 2);
    assert.equal(dropped.length, 0);
  });

  it("drops ideas repeating a rejected niche", () => {
    const { kept, dropped } = filterRepetitiveIdeas(
      [idea("backyard chicken keeper humor gifts", "Chicken Coop Mug")],
      {
        rejectedNiches: ["backyard chicken keeper humor gifts"],
        approvedNiches: [],
        recentTitles: [],
      },
    );
    assert.equal(kept.length, 0);
    assert.equal(dropped.length, 1);
    assert.match(dropped[0]!.reason, /rejected niche/);
  });

  it("drops ideas duplicating an approved niche but keeps adjacent ones", () => {
    const past = {
      rejectedNiches: [],
      approvedNiches: ["reactive rescue dog mom apparel"],
      recentTitles: [],
    };
    const dup = idea("reactive rescue dog mom apparel", "Reactive Dog Mom Tee v2");
    const adjacent = idea(
      "senior special-needs cat adoption pride",
      "Senior Special Needs Cat Adoption Mug",
    );
    const { kept, dropped } = filterRepetitiveIdeas([dup, adjacent], past);
    assert.equal(kept.length, 1);
    assert.equal(kept[0]!.niche, adjacent.niche);
    assert.match(dropped[0]!.reason, /approved niche/);
  });

  it("drops ideas whose concept matches a recent title (suffix ignored)", () => {
    const { kept, dropped } = filterRepetitiveIdeas(
      [
        idea(
          "rescue dog training apparel",
          "Reactive Rescue Dog Mom T-Shirt Celebrating Training Wins",
        ),
      ],
      {
        rejectedNiches: [],
        approvedNiches: [],
        recentTitles: [
          "Reactive Rescue Dog Mom T-Shirt Celebrating Training Wins — 12ab34cd",
        ],
      },
    );
    assert.equal(kept.length, 0);
    assert.match(dropped[0]!.reason, /recent product title/);
  });

  it("drops the second of two near-duplicates in the same batch", () => {
    const first = idea("dog dad fishing buddies", "Dog Dad Fishing Buddy Mug");
    const second = idea(
      "dog dads who fish",
      "Dog Dad Fishing Buddy Coffee Mug",
    );
    const third = idea(
      "cat memorial watercolor",
      "Watercolor Cat Memorial Poster",
    );
    const { kept, dropped } = filterRepetitiveIdeas([first, second, third]);
    assert.equal(kept.length, 2);
    assert.equal(kept[0]!.productConcept, first.productConcept);
    assert.equal(kept[1]!.productConcept, third.productConcept);
    assert.match(dropped[0]!.reason, /another idea in this batch/);
  });
});

describe("isTooSimilar", () => {
  it("respects the threshold", () => {
    assert.equal(
      isTooSimilar("senior dog mug", ["senior dog mug design"], 0.9),
      true,
    );
    assert.equal(isTooSimilar("senior dog mug", ["parrot poster"], 0.5), false);
  });
});
