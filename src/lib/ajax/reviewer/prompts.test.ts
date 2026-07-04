import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildReviewerSystemPrompt,
  REVIEWER_JSON_INSTRUCTIONS,
} from "@/lib/ajax/reviewer/prompts";

describe("buildReviewerSystemPrompt", () => {
  it("names the brand and always includes the five scoring dimensions", () => {
    const p = buildReviewerSystemPrompt("GotchaDayGoods");
    assert.match(p, /GotchaDayGoods/);
    assert.match(p, /ETSY SEO/);
    assert.match(p, /SELLABILITY/);
    assert.match(p, /COMPLIANCE/);
  });

  it("hard-enforces store niche fit when a niche is provided", () => {
    const p = buildReviewerSystemPrompt(
      "GotchaDayGoods",
      "gifts for pet owners",
    );
    assert.match(p, /STORE FIT/);
    assert.match(p, /gifts for pet owners/);
    // off-niche must be a brand failure, not a pass
    assert.match(p, /brand\s*(?:≤|<=)\s*30/i);
  });

  it("omits the store-fit block when no niche is given", () => {
    assert.doesNotMatch(buildReviewerSystemPrompt("Anything"), /STORE FIT/);
    assert.doesNotMatch(buildReviewerSystemPrompt("Anything", "   "), /STORE FIT/);
  });

  it("JSON instructions request all five subscores", () => {
    for (const k of ["seo", "sellability", "brand", "quality", "compliance"]) {
      assert.ok(REVIEWER_JSON_INSTRUCTIONS.includes(k));
    }
  });
});
