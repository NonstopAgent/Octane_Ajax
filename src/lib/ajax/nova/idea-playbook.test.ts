import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildIdeaPlaybookPrompt } from "@/lib/ajax/nova/idea-playbook";
import { NOVA_IDEATION_SYSTEM_PROMPT } from "@/lib/ajax/nova/prompts";

describe("idea playbook", () => {
  it("names the proven levers (personalization, occasion, saturation, seasonal)", () => {
    const p = buildIdeaPlaybookPrompt();
    assert.match(p, /personaliz/i);
    assert.match(p, /occasion/i);
    assert.match(p, /saturat/i);
    assert.match(p, /seasonal/i);
  });

  it("is embedded in Nova's system prompt alongside the pet scope", () => {
    assert.match(NOVA_IDEATION_SYSTEM_PROMPT, /WHAT ACTUALLY SELLS/);
    assert.match(NOVA_IDEATION_SYSTEM_PROMPT, /personaliz/i);
    assert.match(NOVA_IDEATION_SYSTEM_PROMPT, /pet/i);
  });
});
