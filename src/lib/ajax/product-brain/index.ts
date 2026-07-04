import { scoreProductIdea } from "@/lib/ajax/product-brain/scoring";
import { validateProductIdea } from "@/lib/ajax/product-brain/validators";
import type {
  ProductBrainInput,
  ProductBrainScore,
  ProductBrainValidation,
  ProductBrainVerdict,
} from "@/lib/ajax/product-brain/types";

export type {
  ProductBrainInput,
  ProductBrainScore,
  ProductBrainValidation,
  ProductBrainVerdict,
  ProductCategory,
  ProductFormat,
  ProductRiskLevel,
} from "@/lib/ajax/product-brain/types";

export {
  ALLOWED_PRODUCT_CATEGORIES,
  BLOCKED_CONTENT_RULES,
  collectProductText,
  findBlockedContentViolations,
  isAllowedCategory,
  isGenericProductTitle,
} from "@/lib/ajax/product-brain/rules";

export { scoreProductIdea, explainProductScore } from "@/lib/ajax/product-brain/scoring";
export {
  evaluateMarketOpportunity,
  matchMarketSignals,
  estimatePodCost,
  type MarketOpportunity,
  type MarketRecommendation,
  type MarketIdeaInput,
  type MarketKeywordRow,
  type MarketSignals,
} from "@/lib/ajax/product-brain/market-signals";
export {
  validateProductIdea,
  type ProductValidationResult,
} from "@/lib/ajax/product-brain/validators";

const APPROVE_MIN_TOTAL = 62;
const APPROVE_MIN_UTILITY = 58;
const APPROVE_MAX_COMPETITION_RISK = 50;
const BLOCKED_COMPLIANCE_THRESHOLD = 50;

/**
 * Combine validation outcome and score into a generation verdict.
 */
export function getProductBrainVerdict(
  score: ProductBrainScore,
  validation?: ProductBrainValidation,
): ProductBrainVerdict {
  if (validation?.riskLevel === "blocked") {
    return "blocked";
  }

  if (score.complianceRisk >= BLOCKED_COMPLIANCE_THRESHOLD) {
    return "blocked";
  }

  const hasBlockedViolation =
    validation?.violations.some((violation) =>
      /medical|legal|financial|copyrighted|guaranteed results|government/i.test(
        violation,
      ),
    ) ?? false;

  if (hasBlockedViolation) {
    return "blocked";
  }

  const utilityAverage =
    (score.urgency + score.specificity + score.buyerClarity + score.usefulness) /
    4;

  const isStrongUtilityProduct =
    score.totalScore >= APPROVE_MIN_TOTAL &&
    utilityAverage >= APPROVE_MIN_UTILITY &&
    score.specificity >= 55 &&
    score.buyerClarity >= 55 &&
    score.competitionRisk <= APPROVE_MAX_COMPETITION_RISK &&
    score.complianceRisk === 0;

  if (isStrongUtilityProduct) {
    return "approve_for_generation";
  }

  return "needs_revision";
}

/** Score, validate, and return a verdict for a product idea. */
export function evaluateProductIdea(input: ProductBrainInput): {
  score: ProductBrainScore;
  validation: ProductBrainValidation;
  verdict: ProductBrainVerdict;
} {
  const score = scoreProductIdea(input);
  const validation = validateProductIdea(input);
  const verdict = getProductBrainVerdict(score, validation);

  return { score, validation, verdict };
}
