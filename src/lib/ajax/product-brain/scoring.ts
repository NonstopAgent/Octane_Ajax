import {
  collectProductText,
  findBlockedContentViolations,
  formatAlignsWithCopy,
  hasLongTailNicheLanguage,
  hasUrgencySignals,
  hasVagueBuyerLanguage,
  isGenericProductTitle,
  countWords,
} from "@/lib/ajax/product-brain/rules";
import type {
  ProductBrainInput,
  ProductBrainScore,
} from "@/lib/ajax/product-brain/types";

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function scoreBuyerClarity(input: ProductBrainInput): number {
  const buyerWords = countWords(input.targetBuyer);
  if (hasVagueBuyerLanguage(input.targetBuyer)) return 15;
  if (buyerWords >= 4) return 90;
  if (buyerWords >= 2) return 65;
  return 30;
}

function scoreSpecificity(input: ProductBrainInput, combinedText: string): number {
  let score = 40;

  if (!isGenericProductTitle(input.title)) score += 20;
  if (countWords(input.title) >= 6) score += 15;
  if (countWords(input.problemSolved) >= 6) score += 15;
  if (hasLongTailNicheLanguage(combinedText)) score += 20;
  if (countWords(input.niche) >= 3) score += 10;

  return clampScore(score);
}

function scoreUrgency(input: ProductBrainInput, combinedText: string): number {
  const problemWords = countWords(input.problemSolved);
  let score = 35;

  if (problemWords >= 8) score += 25;
  else if (problemWords >= 4) score += 15;

  if (hasUrgencySignals(combinedText)) score += 25;
  if (hasLongTailNicheLanguage(input.problemSolved)) score += 15;

  return clampScore(score);
}

function scoreUsefulness(input: ProductBrainInput, combinedText: string): number {
  let score = 45;

  if (countWords(input.description) >= 12) score += 20;
  if (input.keywords.length >= 3) score += 15;
  if (formatAlignsWithCopy(input.format, combinedText)) score += 20;

  return clampScore(score);
}

function scoreCompetitionRisk(input: ProductBrainInput, combinedText: string): number {
  let risk = 70;

  if (isGenericProductTitle(input.title)) risk += 20;
  if (!hasLongTailNicheLanguage(combinedText)) risk += 10;
  if (countWords(input.niche) <= 2) risk += 10;
  if (hasLongTailNicheLanguage(combinedText)) risk -= 25;
  if (countWords(input.title) >= 7) risk -= 15;
  if (countWords(input.targetBuyer) >= 4) risk -= 10;

  return clampScore(risk);
}

function scoreComplianceRisk(combinedText: string): number {
  const violations = findBlockedContentViolations(combinedText);
  if (violations.length > 0) return 100;
  return 0;
}

/**
 * Score a product idea across utility, specificity, and risk dimensions.
 */
export function scoreProductIdea(input: ProductBrainInput): ProductBrainScore {
  const combinedText = collectProductText(input);

  const buyerClarity = scoreBuyerClarity(input);
  const specificity = scoreSpecificity(input, combinedText);
  const urgency = scoreUrgency(input, combinedText);
  const usefulness = scoreUsefulness(input, combinedText);
  const competitionRisk = scoreCompetitionRisk(input, combinedText);
  const complianceRisk = scoreComplianceRisk(combinedText);

  const utilityAverage = (urgency + specificity + buyerClarity + usefulness) / 4;
  const riskPenalty = competitionRisk * 0.15 + complianceRisk * 0.5;
  const totalScore = clampScore(utilityAverage - riskPenalty);

  return {
    urgency,
    specificity,
    buyerClarity,
    usefulness,
    competitionRisk,
    complianceRisk,
    totalScore,
  };
}

/** Human-readable breakdown of a product brain score. */
export function explainProductScore(score: ProductBrainScore): string {
  const lines = [
    `Total score: ${score.totalScore}/100`,
    `Urgency: ${score.urgency}/100 — how pressing the problem feels`,
    `Specificity: ${score.specificity}/100 — niche focus vs generic positioning`,
    `Buyer clarity: ${score.buyerClarity}/100 — how clearly the target buyer is defined`,
    `Usefulness: ${score.usefulness}/100 — giftability and resonance of the product format`,
    `Competition risk: ${score.competitionRisk}/100 — lower is better (crowded/generic niches score higher)`,
    `Compliance risk: ${score.complianceRisk}/100 — policy/trademark/medical claim exposure`,
  ];

  if (score.complianceRisk >= 50) {
    lines.push("Compliance flags detected — idea should be blocked or revised before generation.");
  } else if (score.totalScore >= 70 && score.competitionRisk <= 45) {
    lines.push("Strong niche-gift positioning — good candidate for generation.");
  } else {
    lines.push("Idea needs more buyer/problem specificity before generation.");
  }

  return lines.join("\n");
}
