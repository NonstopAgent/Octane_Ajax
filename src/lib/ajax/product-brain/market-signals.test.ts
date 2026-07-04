import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateMarketOpportunity,
  matchMarketSignals,
  estimatePodCost,
  type MarketIdeaInput,
  type MarketKeywordRow,
} from "@/lib/ajax/product-brain/market-signals";

const idea = (over: Partial<MarketIdeaInput> = {}): MarketIdeaInput => ({
  title: "Personalized Rescue Dog Mom Gotcha Day Mug",
  niche: "rescue dog mom gotcha day gift",
  targetBuyer: "rescue dog moms celebrating an adoption anniversary",
  problemSolved: "a heartfelt gotcha day keepsake for a newly adopted rescue dog",
  keywords: ["rescue dog mom mug", "gotcha day gift", "adoption anniversary"],
  format: "mug",
  priceUsd: 24,
  ...over,
});

describe("matchMarketSignals", () => {
  it("matches an idea to the best real keyword row by token overlap", () => {
    const rows: MarketKeywordRow[] = [
      { term: "cat dad shirt", searchesPerMonth: 500, competingListings: 400 },
      { term: "rescue dog mom mug", searchesPerMonth: 1200, competingListings: 800 },
    ];
    const m = matchMarketSignals(idea(), rows);
    assert.equal(m.matchedTerm, "rescue dog mom mug");
    assert.equal(m.searchesPerMonth, 1200);
  });

  it("returns nulls when no keyword rows are given", () => {
    const m = matchMarketSignals(idea(), null);
    assert.equal(m.searchesPerMonth, null);
    assert.equal(m.matchedTerm, null);
  });
});

describe("evaluateMarketOpportunity", () => {
  it("recommends LIST when real demand is healthy and supply is low", () => {
    const signals = {
      searchesPerMonth: 1200,
      competingListings: 800,
      matchedTerm: "rescue dog mom mug",
    };
    const r = evaluateMarketOpportunity(idea(), signals);
    assert.equal(r.hasData, true);
    assert.equal(r.recommendation, "list");
    assert.ok(r.marketScore >= 70);
    assert.ok(r.reasons.some((x) => /searches\/mo/.test(x)));
  });

  it("recommends SKIP when the niche is a saturated red ocean", () => {
    const signals = {
      searchesPerMonth: 300,
      competingListings: 250000,
      matchedTerm: "dog mom shirt",
    };
    const r = evaluateMarketOpportunity(idea(), signals);
    assert.equal(r.hasData, true);
    assert.equal(r.recommendation, "skip");
    assert.ok(r.marketScore < 60);
  });

  it("does not hard-skip when there is no demand data (advisory only)", () => {
    const r = evaluateMarketOpportunity(idea(), {
      searchesPerMonth: null,
      competingListings: null,
      matchedTerm: null,
    });
    assert.equal(r.hasData, false);
    assert.equal(r.recommendation, "watch");
    assert.equal(r.demandScore, null);
  });

  it("rewards proven bestseller patterns (personalization + occasion)", () => {
    const strong = evaluateMarketOpportunity(idea(), {
      searchesPerMonth: null,
      competingListings: null,
      matchedTerm: null,
    });
    const generic = evaluateMarketOpportunity(
      idea({
        title: "Dog Mug",
        niche: "dog mug",
        targetBuyer: "people",
        problemSolved: "a mug",
        keywords: ["dog mug"],
      }),
      { searchesPerMonth: null, competingListings: null, matchedTerm: null },
    );
    assert.ok(strong.patternFitScore > generic.patternFitScore);
  });

  it("scores margin from retail vs estimated POD cost", () => {
    const highMargin = evaluateMarketOpportunity(idea({ priceUsd: 30 }), {
      searchesPerMonth: 1000,
      competingListings: 900,
      matchedTerm: "rescue dog mom mug",
    });
    const thinMargin = evaluateMarketOpportunity(idea({ priceUsd: 10 }), {
      searchesPerMonth: 1000,
      competingListings: 900,
      matchedTerm: "rescue dog mom mug",
    });
    assert.ok((highMargin.marginScore ?? 0) > (thinMargin.marginScore ?? 0));
  });

  it("estimates POD cost by format", () => {
    assert.ok(estimatePodCost("sweatshirt") > estimatePodCost("sticker"));
    assert.equal(estimatePodCost(null), estimatePodCost("unknown_format"));
  });
});
