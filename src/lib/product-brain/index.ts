/**
 * Product Brain — Phase 2 deterministic evaluation engine.
 *
 * Entry point: evaluateIdea(idea) → BrainEvaluation
 *
 * Design principles (from AGENTS.md §8):
 * - Deterministic rules and schemas; no LLM calls in this module.
 * - Testable: every rule can be unit-tested with plain inputs.
 * - Auditable: all scoring rationale is recorded in the result.
 *
 * Verdicts:
 *   "blocked"  — compliance flag triggered; idea must not proceed
 *   "weak"     — total score < 40; needs significant rework
 *   "viable"   — total score 40–69; can proceed with human review
 *   "strong"   — total score ≥ 70; high confidence, still needs review
 */

export { checkCompliance, isBlocked } from "./compliance";
export { scoreIdea } from "./scorer";
export type {
  BrainEvaluation,
  BrainScore,
  BrainValidation,
  BrainVerdict,
  ComplianceFlags,
  ProductIdeaInput,
} from "./types";

import { checkCompliance, isBlocked } from "./compliance";
import { scoreIdea } from "./scorer";
import type { BrainEvaluation, BrainVerdict, ProductIdeaInput } from "./types";

/**
 * Evaluate a product idea against all strategy rules.
 *
 * @param idea - The idea to evaluate (from DB or form input)
 * @returns    A complete BrainEvaluation that can be persisted to product_ideas
 */
export function evaluateIdea(idea: ProductIdeaInput): BrainEvaluation {
  // 1. Compliance check
  const fullText = [
    idea.title ?? "",
    idea.description ?? "",
    idea.niche ?? "",
    ...(idea.seo_keywords ?? []),
  ].join(" ");

  const { flags, warnings } = checkCompliance(fullText);
  const blocked = isBlocked(flags);

  // 2. Scoring
  const score = scoreIdea(idea, blocked);

  // 3. Strengths & weaknesses for human readability
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  if (score.specificity >= 15)
    strengths.push("Specific target audience or niche identified.");
  if (score.specificity < 8)
    weaknesses.push("Audience or problem is too generic.");

  if (score.format_fit >= 15)
    strengths.push("Clear printable/utility format detected.");
  if (score.format_fit < 5)
    weaknesses.push("Product format is unclear or not printable/utility.");

  if (score.demand >= 15) strengths.push("Good keyword breadth and demand signal.");
  if (score.demand < 8) weaknesses.push("Low keyword count or trend score — validate demand.");

  if (!blocked) strengths.push("No compliance flags triggered.");
  if (blocked) weaknesses.push("One or more compliance rules triggered — requires human review.");

  // 4. Verdict
  let verdict: BrainVerdict;
  if (blocked) {
    verdict = "blocked";
  } else if (score.total >= 70) {
    verdict = "strong";
  } else if (score.total >= 40) {
    verdict = "viable";
  } else {
    verdict = "weak";
  }

  return {
    score,
    validation: {
      compliance_flags: flags,
      compliance_warnings: warnings,
      strengths,
      weaknesses,
    },
    verdict,
    evaluated_at: new Date().toISOString(),
  };
}
