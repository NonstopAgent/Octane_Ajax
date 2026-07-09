import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type OpenAI from "openai";
import {
  buildMedicUserPrompt,
  generateListingFix,
  sanitizeMedicTags,
} from "@/lib/ajax/autopilot/listing-medic";
import {
  repeatedTitleWords,
  titleStyleIssues,
} from "@/lib/ajax/product-brain/rules";
import { AI_DISCLOSURE_TEXT } from "@/lib/ajax/forge/types";

const thirteenTags = [
  "rescue dog mom mug",
  "gotcha day gift",
  "dog adoption gift",
  "senior dog lover",
  "pet parent mug",
  "dog mom coffee cup",
  "adoption day gift",
  "rescue pet gift",
  "dog lover present",
  "pet memorial gift",
  "dog mama mug",
  "fur mom gift idea",
  "new dog owner gift",
];

function mockClient(content: string): OpenAI {
  return {
    chat: {
      completions: {
        create: async () => ({
          model: "gpt-4o-mini",
          choices: [{ message: { content } }],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        }),
      },
    },
  } as unknown as OpenAI;
}

const baseInput = {
  title: "Custom Adoption Day Cat Portrait Mug | Personalized Cat Gift",
  description: `A lovely mug for cat parents.\n\n${AI_DISCLOSURE_TEXT}`,
  tags: thirteenTags.slice(0, 10),
  issues: ["Uses 10 of 13 tags — fill all 13."],
};

describe("sanitizeMedicTags", () => {
  it("dedupes, trims to 20 chars, prefers multi-word, pads from candidates", () => {
    const out = sanitizeMedicTags(
      ["cat", "cat mom gift", "cat mom gift", "a very long tag that keeps going forever"],
      thirteenTags,
    );
    assert.equal(out.length, 13);
    assert.ok(out.every((t) => t.length <= 20));
    assert.equal(new Set(out.map((t) => t.toLowerCase())).size, 13);
    assert.ok(out.includes("cat mom gift"));
  });
});

describe("buildMedicUserPrompt", () => {
  it("includes the flagged issues and current fields", () => {
    const prompt = buildMedicUserPrompt(baseInput);
    assert.match(prompt, /Uses 10 of 13 tags/);
    assert.match(prompt, /CURRENT TITLE/);
    assert.match(prompt, /Cat Portrait Mug/);
  });
});

describe("titleStyleIssues (Etsy title checker rules)", () => {
  it("flags titles over 14 words", () => {
    const stuffed =
      "Adopted and Loved Rescue Dog Poster | Dog Adoption Gift | Gotcha Day Gift | Dog Mom Wall Art | Animal Rescue Print | Pet Lover Decor";
    const issues = titleStyleIssues(stuffed);
    assert.ok(issues.some((i) => i.includes("words")));
  });

  it("flags heavy repetition (word 3x, or two words doubled)", () => {
    // "dog" x3, "gift" x3 in the classic stuffed title above.
    const repeats = repeatedTitleWords(
      "Rescue Dog Poster | Dog Adoption Gift | Dog Mom Wall Art Gift | Rescue Gift",
    );
    assert.ok(repeats.some(([w, n]) => w === "dog" && n >= 3));
    assert.ok(
      titleStyleIssues(
        "Rescue Dog Poster | Dog Adoption Gift | Dog Mom Wall Art Gift | Rescue Gift",
      ).length > 0,
    );
    // Two different words each doubled is also flagged.
    assert.ok(
      titleStyleIssues(
        "Rescue Dog Mug | Rescue Gift for Dog Moms Everywhere Today",
      ).length > 0,
    );
  });

  it("tolerates one doubled word (Etsy's own suggestions do this)", () => {
    assert.equal(
      titleStyleIssues(
        "Custom Cat Adoption Portrait Mug | Personalized Cat Lover Gift",
      ).length,
      0,
    );
    assert.equal(
      titleStyleIssues(
        "Adopted and Loved Rescue Dog Poster | Gotcha Day Wall Art Print",
      ).length,
      0,
    );
  });
});

describe("generateListingFix", () => {
  it("returns a validated fix and preserves the AI disclosure", async () => {
    const client = mockClient(
      JSON.stringify({
        title: baseInput.title,
        description:
          "A lovely ceramic mug for cat parents celebrating adoption day — made to order, dishwasher safe, and a warm gift for the cat mom in your life.",
        tags: thirteenTags,
      }),
    );
    const fix = await generateListingFix(baseInput, { client });
    assert.ok(fix);
    assert.equal(fix!.tags.length, 13);
    assert.ok(fix!.description.includes(AI_DISCLOSURE_TEXT));
    assert.ok(fix!.changed.includes("tags"));
  });

  it("keeps the original title when the model's rewrite violates Etsy title style", async () => {
    const client = mockClient(
      JSON.stringify({
        title:
          "Cat Mug Cat Gift | Cat Present for Cat Lovers | Cat Mom Cat Mug Cat Cup Idea",
        description:
          "A lovely ceramic mug for cat parents celebrating adoption day — made to order, dishwasher safe, and a warm gift for the cat mom in your life.",
        tags: thirteenTags,
      }),
    );
    const fix = await generateListingFix(baseInput, { client });
    assert.ok(fix);
    assert.equal(fix!.title, baseInput.title);
    assert.ok(!fix!.changed.includes("title"));
    assert.ok(fix!.changed.includes("tags"));
  });

  it("rejects a fix whose copy still contains blocked content", async () => {
    const client = mockClient(
      JSON.stringify({
        title: baseInput.title,
        description:
          "This mug is FDA approved and guaranteed results for treating anxiety in cats.",
        tags: thirteenTags,
      }),
    );
    const fix = await generateListingFix(baseInput, { client });
    assert.equal(fix, null);
  });

  it("returns null when nothing changed", async () => {
    const client = mockClient(
      JSON.stringify({
        title: baseInput.title,
        description: baseInput.description,
        tags: baseInput.tags.concat(thirteenTags).slice(0, 13),
      }),
    );
    // Same title/description; tags DO change (padded to 13) — so this should
    // still return a fix. Force the no-change case with identical 13 tags.
    const identical = await generateListingFix(
      { ...baseInput, tags: thirteenTags },
      {
        client: mockClient(
          JSON.stringify({
            title: baseInput.title,
            description: baseInput.description,
            tags: thirteenTags,
          }),
        ),
      },
    );
    assert.equal(identical, null);
    void client;
  });
});
