import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AGENT_MICROCOPY,
  getAgentActivityLine,
  getAgentDisplayName,
  PIPELINE_STAGES,
  REVIEW_GATE_MICROCOPY,
} from "@/lib/ajax/constants";

describe("ajax constants", () => {
  it("defines agent microcopy for Nova, Forge, Pixel", () => {
    assert.equal(AGENT_MICROCOPY.nova, "Scanning demand signals");
    assert.equal(AGENT_MICROCOPY.forge, "Manufacturing listing assets");
    assert.equal(AGENT_MICROCOPY.pixel, "Packaging content for distribution");
  });

  it("defines review gate microcopy", () => {
    assert.equal(REVIEW_GATE_MICROCOPY, "Human quality checkpoint");
  });

  it("returns activity line when agent is working", () => {
    assert.equal(getAgentActivityLine("nova", "working"), AGENT_MICROCOPY.nova);
    assert.equal(
      getAgentActivityLine("forge", "thinking"),
      AGENT_MICROCOPY.forge,
    );
  });

  it("returns standing by when idle", () => {
    assert.equal(getAgentActivityLine("pixel", "idle"), "Standing by");
  });

  it("has ordered pipeline stages ending at storefront", () => {
    assert.equal(PIPELINE_STAGES.length, 5);
    assert.equal(PIPELINE_STAGES[0]?.agentSlug, "nova");
    assert.equal(PIPELINE_STAGES.at(-1)?.roomSlug, "storefront");
  });

  it("resolves display names", () => {
    assert.equal(getAgentDisplayName("nova"), "Nova");
  });
});
