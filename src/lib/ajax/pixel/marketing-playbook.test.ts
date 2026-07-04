import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMarketingPlaybookPrompt } from "@/lib/ajax/pixel/marketing-playbook";
import { PIXEL_MARKETING_SYSTEM_PROMPT } from "@/lib/ajax/pixel/prompts";

describe("marketing playbook", () => {
  it("names the proven conversion levers", () => {
    const p = buildMarketingPlaybookPrompt();
    assert.match(p, /hook/i);
    assert.match(p, /Pinterest/);
    assert.match(p, /hashtag/i);
    assert.match(p, /link/i);
  });

  it("is embedded in Pixel's marketing system prompt", () => {
    assert.match(PIXEL_MARKETING_SYSTEM_PROMPT, /WHAT ACTUALLY CONVERTS/);
    assert.match(PIXEL_MARKETING_SYSTEM_PROMPT, /Pinterest/);
  });
});
