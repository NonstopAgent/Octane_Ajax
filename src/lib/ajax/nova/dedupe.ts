/**
 * Hard repetition guard for Nova ideation.
 *
 * The system prompt ASKS the LLM not to repeat past niches/titles, but prompt
 * instructions are soft — when a model ignores them (or a provider outage
 * loops the same concepts) the factory used to publish near-identical
 * listings back to back. This module enforces variety deterministically:
 * any generated idea whose concept or niche is too similar to recent history
 * — or to another idea in the same batch — is dropped before it can reach
 * Product Brain / Forge.
 */
import type { NovaPastContext } from "@/lib/ajax/nova/past-context";

/** Tokens that carry no meaning for similarity ("mug for dog moms" vs "dog mom mug"). */
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "for", "with", "to", "in", "on",
  "your", "my", "their", "her", "his", "who", "that", "this", "at", "by",
  "gift", "gifts", "print", "on-demand", "pod", "etsy",
]);

/** Hex/run-id fragments (fallback titles append one) never count as content. */
const RUNID_TOKEN = /^[0-9a-f]{6,}$/;

export function normalizeTokens(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .map((t) => t.trim())
    .filter(
      (t) =>
        t.length > 1 && !STOPWORDS.has(t) && !RUNID_TOKEN.test(t),
    )
    // Crude singularization so "mugs"/"mug" and "moms"/"mom" collide.
    .map((t) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t));
  return new Set(tokens);
}

/**
 * Containment similarity: |A ∩ B| / min(|A|, |B|), 0..1.
 * Containment (not plain Jaccard) so a short niche fully embedded in a longer
 * title still registers as a repeat.
 */
export function textSimilarity(a: string, b: string): number {
  const ta = normalizeTokens(a);
  const tb = normalizeTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / Math.min(ta.size, tb.size);
}

export function isTooSimilar(
  candidate: string,
  history: readonly string[],
  threshold: number,
): boolean {
  return history.some((h) => textSimilarity(candidate, h) >= threshold);
}

export type IdeaLikeForDedupe = {
  niche: string;
  productConcept: string;
};

export type RepetitionFilterResult<T extends IdeaLikeForDedupe> = {
  kept: T[];
  dropped: { idea: T; reason: string }[];
};

/**
 * Concept vs recent-title similarity that counts as a repeat.
 * Tuned to 0.85: at 0.75 the guard starved whole cycles into the fallback
 * pool (most pet-gift concepts share dog/rescue/mug-type tokens), which then
 * published literal clones — worse than an adjacent-but-distinct LLM idea.
 */
export const CONCEPT_REPEAT_THRESHOLD = 0.85;
/** Niche vs rejected-niche similarity that counts as a repeat. */
export const REJECTED_NICHE_THRESHOLD = 0.8;
/** Niche vs approved-niche similarity that counts as a duplicate (adjacent is fine, identical is not). */
export const APPROVED_NICHE_THRESHOLD = 0.9;

/**
 * Drop ideas that repeat operator history or each other.
 * Order-preserving; the first of two near-duplicates in a batch survives.
 */
export function filterRepetitiveIdeas<T extends IdeaLikeForDedupe>(
  ideas: readonly T[],
  pastContext?: NovaPastContext,
): RepetitionFilterResult<T> {
  const kept: T[] = [];
  const dropped: { idea: T; reason: string }[] = [];

  const rejectedNiches = pastContext?.rejectedNiches ?? [];
  const approvedNiches = pastContext?.approvedNiches ?? [];
  const recentTitles = pastContext?.recentTitles ?? [];

  for (const idea of ideas) {
    if (isTooSimilar(idea.niche, rejectedNiches, REJECTED_NICHE_THRESHOLD)) {
      dropped.push({ idea, reason: "repeats a previously rejected niche" });
      continue;
    }
    if (isTooSimilar(idea.niche, approvedNiches, APPROVED_NICHE_THRESHOLD)) {
      dropped.push({
        idea,
        reason: "duplicates an already-approved niche (adjacent is fine, identical is not)",
      });
      continue;
    }
    if (
      isTooSimilar(idea.productConcept, recentTitles, CONCEPT_REPEAT_THRESHOLD)
    ) {
      dropped.push({ idea, reason: "too similar to a recent product title" });
      continue;
    }
    const batchClash = kept.some(
      (k) =>
        textSimilarity(idea.productConcept, k.productConcept) >=
          CONCEPT_REPEAT_THRESHOLD ||
        textSimilarity(idea.niche, k.niche) >= APPROVED_NICHE_THRESHOLD,
    );
    if (batchClash) {
      dropped.push({ idea, reason: "near-duplicate of another idea in this batch" });
      continue;
    }
    kept.push(idea);
  }

  return { kept, dropped };
}
