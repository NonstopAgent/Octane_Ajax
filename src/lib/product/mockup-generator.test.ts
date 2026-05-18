import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildListingMockupPrompt } from "@/lib/product/mockup-generator";

describe("mockup-generator", () => {
  it("buildListingMockupPrompt uses coverImagePrompt when provided", () => {
    const prompt = buildListingMockupPrompt("Meal Prep Planner", "Soft pastel desk flat-lay");
    assert.match(prompt, /Soft pastel desk flat-lay/);
    assert.match(prompt, /No logos/);
  });

  it("buildListingMockupPrompt falls back to listing title", () => {
    const prompt = buildListingMockupPrompt("Weekly Budget Tracker");
    assert.match(prompt, /Weekly Budget Tracker/);
  });
});
