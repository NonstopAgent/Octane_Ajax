import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import type OpenAI from "openai";
import { completeJson } from "@/lib/llm/json";

const NovaResearchSchema = z.object({
  niche: z.string(),
  problem: z.string(),
  productConcept: z.string(),
  suggestedPrice: z.number(),
});

type MockResponse =
  | { content: string; model?: string }
  | Error;

function createMockOpenAiClient(
  responses: MockResponse[],
): OpenAI {
  let callIndex = 0;

  return {
    chat: {
      completions: {
        create: async () => {
          const next = responses[callIndex];
          callIndex += 1;
          if (!next) {
            throw new Error("Mock OpenAI client: no more queued responses.");
          }
          if (next instanceof Error) {
            throw next;
          }

          return {
            model: next.model ?? "gpt-4o-mini",
            choices: [{ message: { content: next.content } }],
            usage: {
              prompt_tokens: 42,
              completion_tokens: 18,
              total_tokens: 60,
            },
          };
        },
      },
    },
  } as unknown as OpenAI;
}

describe("completeJson", () => {
  it("parses and validates structured JSON from a mocked OpenAI client", async () => {
    const client = createMockOpenAiClient([
      {
        content: JSON.stringify({
          niche: "meal prep for night-shift nurses",
          problem: "inconsistent weekly grocery planning",
          productConcept: "Night-shift weekly meal prep planner",
          suggestedPrice: 4.99,
        }),
      },
    ]);

    const result = await completeJson({
      messages: [{ role: "user", content: "Research a utility printable product." }],
      schema: NovaResearchSchema,
      client,
      maxRetries: 0,
    });

    assert.equal(result.attempts, 1);
    assert.equal(result.model, "gpt-4o-mini");
    assert.equal(result.usage.totalTokens, 60);
    assert.equal(result.data.niche, "meal prep for night-shift nurses");
    assert.equal(result.data.suggestedPrice, 4.99);
  });

  it("retries when the model returns invalid JSON then succeeds", async () => {
    const client = createMockOpenAiClient([
      { content: "not-json" },
      {
        content: JSON.stringify({
          niche: "ADHD student planners",
          problem: "missed assignment deadlines",
          productConcept: "Semester assignment tracker",
          suggestedPrice: 3.5,
        }),
      },
    ]);

    const result = await completeJson({
      messages: [{ role: "user", content: "Output research JSON." }],
      schema: NovaResearchSchema,
      client,
      maxRetries: 1,
    });

    assert.equal(result.attempts, 2);
    assert.equal(result.data.productConcept, "Semester assignment tracker");
  });

  it("retries when JSON fails Zod validation then succeeds", async () => {
    const client = createMockOpenAiClient([
      {
        content: JSON.stringify({
          niche: "habit tracking",
          problem: "forgetting routines",
          productConcept: "Habit tracker",
          suggestedPrice: "free",
        }),
      },
      {
        content: JSON.stringify({
          niche: "habit tracking",
          problem: "forgetting routines",
          productConcept: "Habit tracker",
          suggestedPrice: 2.99,
        }),
      },
    ]);

    const result = await completeJson({
      messages: [{ role: "user", content: "Output research JSON." }],
      schema: NovaResearchSchema,
      client,
      maxRetries: 1,
    });

    assert.equal(result.attempts, 2);
    assert.equal(result.data.suggestedPrice, 2.99);
  });

  it("retries on retryable API errors then succeeds", async () => {
    const client = createMockOpenAiClient([
      new Error("429 rate limit exceeded"),
      {
        content: JSON.stringify({
          niche: "small business inventory",
          problem: "stockouts on best sellers",
          productConcept: "Weekly inventory reorder sheet",
          suggestedPrice: 5.49,
        }),
      },
    ]);

    const result = await completeJson({
      messages: [{ role: "user", content: "Output research JSON." }],
      schema: NovaResearchSchema,
      client,
      maxRetries: 1,
    });

    assert.equal(result.attempts, 2);
    assert.equal(result.data.problem, "stockouts on best sellers");
  });

  it("throws after exhausting retries on persistent invalid output", async () => {
    const client = createMockOpenAiClient([
      { content: "{}" },
      { content: "{}" },
    ]);

    await assert.rejects(
      () =>
        completeJson({
          messages: [{ role: "user", content: "Output research JSON." }],
          schema: NovaResearchSchema,
          client,
          maxRetries: 1,
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        return true;
      },
    );
  });

  it("does not retry non-retryable configuration errors", async () => {
    const client = createMockOpenAiClient([
      new Error("401 Incorrect API key provided"),
    ]);

    await assert.rejects(
      () =>
        completeJson({
          messages: [{ role: "user", content: "Output research JSON." }],
          schema: NovaResearchSchema,
          client,
          maxRetries: 2,
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /401|API key/i);
        return true;
      },
    );
  });
});
