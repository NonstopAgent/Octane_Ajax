import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatSignalsForPrompt,
  type WarRoomSignals,
} from "@/lib/ajax/warroom/signals";

const base: WarRoomSignals = {
  marketOpportunities: [
    { term: "rescue dog mom mug", searchesPerMonth: 1200, competingListings: 800 },
  ],
  shopHealth: {
    overallScore: 72,
    listingCount: 5,
    critical: 1,
    warning: 3,
    topFixes: ["Add a real mockup image"],
  },
};

describe("formatSignalsForPrompt", () => {
  it("surfaces real market demand and shop-health with numbers", () => {
    const p = formatSignalsForPrompt(base);
    assert.match(p, /MARKET OPPORTUNITY/);
    assert.match(p, /rescue dog mom mug/);
    assert.match(p, /1200\/mo/);
    assert.match(p, /800 competing/);
    assert.match(p, /SHOP HEALTH/);
    assert.match(p, /72\/100/);
    assert.match(p, /Add a real mockup image/);
  });

  it("falls back cleanly when there is no demand data", () => {
    const p = formatSignalsForPrompt({ ...base, marketOpportunities: [] });
    assert.match(p, /no real keyword demand data/i);
  });
});
