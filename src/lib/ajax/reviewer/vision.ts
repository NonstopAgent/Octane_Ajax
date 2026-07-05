/**
 * Vision review — the reviewer's EYES. Attaches the real product mockup to a
 * vision-capable OpenAI model so it judges the actual design (centered, safe
 * margins, high-contrast, clean, professional, on-brand), not just the text.
 * Self-contained (own OpenAI call, own schema) so it never destabilizes the
 * shared LLM router, and returns null on any failure → the caller falls back to
 * the text/heuristic review. Gated on OPENAI_API_KEY + a real https image.
 */
import { z } from "zod";
import { createOpenAiClient, isOpenAiConfigured } from "@/lib/llm/openai";
import {
  buildReviewerSystemPrompt,
  REVIEWER_JSON_INSTRUCTIONS,
} from "@/lib/ajax/reviewer/prompts";

const VisionSchema = z.object({
  subscores: z.object({
    seo: z.union([z.number(), z.string()]),
    sellability: z.union([z.number(), z.string()]),
    brand: z.union([z.number(), z.string()]),
    quality: z.union([z.number(), z.string()]),
    compliance: z.union([z.number(), z.string()]),
  }),
  reasons: z.array(z.string()).optional().default([]),
  fixes: z.array(z.string()).optional().default([]),
  hardBlock: z.boolean().optional().default(false),
});

export type VisionReviewOut = {
  subscores: {
    seo: number;
    sellability: number;
    brand: number;
    quality: number;
    compliance: number;
  };
  reasons: string[];
  fixes: string[];
  hardBlock: boolean;
  model: string;
};

/** True when a vision review can run (OpenAI key present). */
export function isVisionReviewAvailable(): boolean {
  return isOpenAiConfigured();
}

const num = (v: unknown) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));

export async function visionReview(args: {
  brand: string;
  storeNiche?: string | null;
  payload: unknown;
  imageUrl: string;
  marketNote?: string | null;
}): Promise<VisionReviewOut | null> {
  try {
    const client = createOpenAiClient({ timeout: 25_000 });
    const model = process.env.OPENAI_VISION_MODEL?.trim() || "gpt-4o-mini";
    const system = [
      buildReviewerSystemPrompt(args.brand, args.storeNiche),
      "You can SEE the attached mockup image. Judge the DESIGN itself: is the subject centered with safe margins, high-contrast and readable, clean (no clutter or misspelled text), and professional enough to sell? Weight image quality heavily in the 'quality' score, and cite what you see in reasons/fixes.",
      "Respond with a single valid JSON object only. No markdown, prose, or commentary.",
      REVIEWER_JSON_INSTRUCTIONS,
    ].join("\n\n");
    const userText = `LISTING (JSON):\n${JSON.stringify(args.payload)}${
      args.marketNote ? `\n\nMARKET: ${args.marketNote}` : ""
    }`;

    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            { type: "image_url", image_url: { url: args.imageUrl } },
          ],
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 1200,
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return null;
    const parsed = VisionSchema.parse(JSON.parse(raw));
    return {
      subscores: {
        seo: num(parsed.subscores.seo),
        sellability: num(parsed.subscores.sellability),
        brand: num(parsed.subscores.brand),
        quality: num(parsed.subscores.quality),
        compliance: num(parsed.subscores.compliance),
      },
      reasons: parsed.reasons.slice(0, 6),
      fixes: parsed.fixes.slice(0, 6),
      hardBlock: parsed.hardBlock,
      model: `${completion.model ?? model}+vision`,
    };
  } catch {
    return null;
  }
}
