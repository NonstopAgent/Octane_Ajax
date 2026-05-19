/**
 * Deterministic scoring rules for product ideas.
 *
 * Each dimension produces 0–25 points. No LLM calls — pure rules.
 * This makes the system auditable and testable.
 */

import type { BrainScore, ProductIdeaInput } from "./types";

// ---------------------------------------------------------------------------
// Utility keywords that signal a printable/utility format
// ---------------------------------------------------------------------------

const FORMAT_KEYWORDS = [
  "planner",
  "tracker",
  "worksheet",
  "checklist",
  "template",
  "logbook",
  "journal",
  "calendar",
  "schedule",
  "organizer",
  "workbook",
  "printable",
  "pdf",
  "chart",
  "log",
  "record",
  "form",
  "spreadsheet",
  "ledger",
];

// ---------------------------------------------------------------------------
// Specificity helpers
// ---------------------------------------------------------------------------

const SPECIFICITY_BOOSTERS = [
  // Specific audiences
  "nurse",
  "teacher",
  "student",
  "parent",
  "freelancer",
  "entrepreneur",
  "athlete",
  "caregiver",
  "traveler",
  "homeowner",
  "dog owner",
  "cat owner",
  "gardener",
  "runner",
  "reader",
  // Specific problems
  "budget",
  "habit",
  "meal plan",
  "workout",
  "reading list",
  "sleep",
  "anxiety",
  "focus",
  "password",
  "grocery",
  "chore",
  "homework",
];

function textOf(idea: ProductIdeaInput): string {
  return [
    idea.title ?? "",
    idea.description ?? "",
    idea.niche ?? "",
    ...(idea.seo_keywords ?? []),
  ]
    .join(" ")
    .toLowerCase();
}

function countMatches(text: string, words: string[]): number {
  return words.filter((w) => text.includes(w.toLowerCase())).length;
}

// ---------------------------------------------------------------------------
// Dimension scorers (each returns 0–25)
// ---------------------------------------------------------------------------

function scoreSpecificity(idea: ProductIdeaInput): number {
  const text = textOf(idea);
  const matches = countMatches(text, SPECIFICITY_BOOSTERS);
  const hasNiche = Boolean(idea.niche?.trim());
  const titleWords = (idea.title ?? "").split(/\s+/).length;

  let score = 0;
  if (hasNiche) score += 8;
  if (titleWords >= 4) score += 5; // longer titles tend to be more specific
  score += Math.min(matches * 3, 12); // up to 12 from keyword matches

  return Math.min(score, 25);
}

function scoreFormatFit(idea: ProductIdeaInput): number {
  const text = textOf(idea);
  const matches = countMatches(text, FORMAT_KEYWORDS);
  return Math.min(matches * 5, 25);
}

function scoreCompliance(hasViolations: boolean): number {
  return hasViolations ? 0 : 25;
}

function scoreDemand(idea: ProductIdeaInput): number {
  const trendScore = idea.trend_score ?? 0;
  const keywordCount = (idea.seo_keywords ?? []).length;

  // Trend score is 0–100 internally; map to 0–15 points
  const trendPoints = Math.min((trendScore / 100) * 15, 15);
  // Up to 10 points for keyword breadth (more keywords = broader SEO signal)
  const kwPoints = Math.min(keywordCount * 1.5, 10);

  return Math.round(Math.min(trendPoints + kwPoints, 25));
}

// ---------------------------------------------------------------------------
// Main scorer
// ---------------------------------------------------------------------------

export function scoreIdea(
  idea: ProductIdeaInput,
  hasComplianceViolation: boolean,
): BrainScore {
  const specificity = scoreSpecificity(idea);
  const format_fit = scoreFormatFit(idea);
  const compliance = scoreCompliance(hasComplianceViolation);
  const demand = scoreDemand(idea);

  return {
    specificity,
    format_fit,
    compliance,
    demand,
    total: specificity + format_fit + compliance + demand,
  };
}
