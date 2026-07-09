/**
 * Listing Medic — the piece that ACTS on Store QA findings instead of just
 * reporting them. Given a live listing with fixable problems (incomplete
 * tags, risky copy, weak title), it asks the LLM for a corrected version,
 * validates the output hard (13 multi-word tags ≤20 chars, no blocked
 * content, product word preserved), and returns a safe Etsy patch.
 *
 * The autopilot applies these hourly, worst listings first — so the shop's
 * QA score climbs on its own.
 */
import { z } from "zod";
import type OpenAI from "openai";
import { completeJson } from "@/lib/llm/json";
import { ETSY_PLAYBOOK } from "@/lib/ajax/reviewer/playbook";
import { findBlockedContentViolations } from "@/lib/ajax/product-brain/rules";
import { AI_DISCLOSURE_TEXT } from "@/lib/ajax/forge/types";

export const MEDIC_PROMPT_VERSION = "listing-medic-v1";

const MedicResponseSchema = z.object({
  title: z.string().min(10).max(140),
  description: z.string().min(80),
  tags: z.array(z.string().min(3)).length(13),
});

export type MedicInput = {
  title: string;
  description: string;
  tags: string[];
  /** QA issue summaries driving the fix (shown to the model). */
  issues: string[];
  niche?: string | null;
  /** Proven Etsy search terms to prefer in tags. */
  marketKeywords?: string[];
};

export type MedicFix = {
  title: string;
  description: string;
  tags: string[];
  /** Which fields actually changed. */
  changed: ("title" | "description" | "tags")[];
};

const bullets = (items: readonly string[]) =>
  items.map((s) => `- ${s}`).join("\n");

const MEDIC_SYSTEM_PROMPT = `You are the listing surgeon for GotchaDayGoods — an Etsy shop selling print-on-demand gifts for PET PARENTS (adoption/gotcha day, senior pets, memorials, pet-parent pride).

You receive ONE live Etsy listing plus a list of specific quality problems. Repair ONLY what is broken while keeping the same product, design meaning, and voice. Never invent a different product.

TITLE rules — "${ETSY_PLAYBOOK.title.structure}":
${bullets(ETSY_PLAYBOOK.title.rules)}
- Keep the product word (Mug, T-Shirt, Poster, Sweatshirt) that is already there.

TAGS — return EXACTLY ${ETSY_PLAYBOOK.tags.count}:
${bullets(ETSY_PLAYBOOK.tags.rules)}
- Every tag is a MULTI-WORD long-tail phrase, each 20 characters or fewer.
- Prefer the proven market search terms provided, then niche/buyer/occasion phrases.

DESCRIPTION:
- Keep the existing structure and facts; strengthen the hook and benefits only if flagged.
- If the AI-assistance disclosure sentence is present, keep it VERBATIM.

STRICTLY REMOVE AND NEVER ADD: copyrighted brands/characters/franchises, medical or health claims, guaranteed outcomes, "official" claims, legal/financial advice. If the copy contains any such phrase, rewrite that sentence cleanly without it.`;

export function buildMedicUserPrompt(input: MedicInput): string {
  return `Fix this live Etsy listing. Problems flagged by the quality audit:
${bullets(input.issues)}

CURRENT TITLE:
${input.title}

CURRENT DESCRIPTION:
${input.description}

CURRENT TAGS (${input.tags.length}/13): ${input.tags.join(", ") || "(none)"}
${input.niche ? `NICHE: ${input.niche}` : ""}
${
  input.marketKeywords?.length
    ? `PROVEN MARKET SEARCH TERMS (verified volume — work each one that fits into the 13 tags): ${input.marketKeywords.join(", ")}`
    : ""
}

Return the corrected listing. Change as little as possible beyond the flagged problems.`;
}

const MEDIC_JSON_INSTRUCTIONS = `Return JSON with this exact shape:
{
  "title": "string — corrected Etsy title, ≤140 chars, front-loaded buyer phrase, keeps the product word",
  "description": "string — corrected description (keep the AI-assistance disclosure sentence verbatim if it was present)",
  "tags": ["string", ...] (EXACTLY 13 multi-word long-tail phrases, each ≤20 characters, unique, no brand names)
}`;

/** Etsy tag hard limits: ≤20 chars, unique, multi-word preferred. */
export function sanitizeMedicTags(
  tags: string[],
  fallbackCandidates: string[] = [],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string) => {
    const tag = raw.trim().replace(/\s+/g, " ").slice(0, 20).trim();
    const key = tag.toLowerCase();
    if (tag.length >= 3 && !seen.has(key) && out.length < 13) {
      seen.add(key);
      out.push(tag);
    }
  };
  // Multi-word tags first (Etsy long-tail), then whatever remains.
  for (const t of tags) if (t.trim().includes(" ")) push(t);
  for (const t of tags) push(t);
  for (const t of fallbackCandidates) if (out.length < 13) push(t);
  return out;
}

/**
 * Generate a validated fix. Returns null when the model output is unusable
 * (schema fail, blocked content survived, or nothing actually changed) —
 * callers then leave the listing alone rather than risk making it worse.
 */
export async function generateListingFix(
  input: MedicInput,
  options: { client?: OpenAI } = {},
): Promise<MedicFix | null> {
  const result = await completeJson({
    task: "listing",
    messages: [
      { role: "system", content: MEDIC_SYSTEM_PROMPT },
      { role: "user", content: buildMedicUserPrompt(input) },
    ],
    schema: MedicResponseSchema,
    jsonInstructions: MEDIC_JSON_INSTRUCTIONS,
    options: { temperature: 0.4, maxTokens: 1800 },
    timeout: 25_000,
    client: options.client,
  }).catch(() => null);

  if (!result) return null;

  const title = result.data.title.trim();
  let description = result.data.description.trim();

  // The disclosure sentence must survive verbatim when it was present.
  if (
    input.description.includes(AI_DISCLOSURE_TEXT) &&
    !description.includes(AI_DISCLOSURE_TEXT)
  ) {
    description = `${description}\n\n${AI_DISCLOSURE_TEXT}`;
  }

  // Blocked content must be GONE from the fixed copy — otherwise reject the
  // fix entirely (never ship copy the QA sweep would re-flag).
  const violations = findBlockedContentViolations(`${title} ${description}`);
  if (violations.length > 0) return null;

  const tags = sanitizeMedicTags(result.data.tags, [
    ...(input.marketKeywords ?? []),
    ...input.tags,
  ]);
  if (tags.length !== 13) return null;

  const changed: MedicFix["changed"] = [];
  if (title !== input.title.trim()) changed.push("title");
  if (description !== input.description.trim()) changed.push("description");
  const sameTags =
    tags.length === input.tags.length &&
    tags.every(
      (t, i) => t.toLowerCase() === (input.tags[i] ?? "").toLowerCase(),
    );
  if (!sameTags) changed.push("tags");
  if (changed.length === 0) return null;

  return { title, description, tags, changed };
}
