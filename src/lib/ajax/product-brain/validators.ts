import {
  ALLOWED_PRODUCT_CATEGORIES,
  collectProductText,
  findBlockedContentViolations,
  hasVagueBuyerLanguage,
  isAllowedCategory,
  isGenericProductTitle,
} from "@/lib/ajax/product-brain/rules";
import type {
  ProductBrainInput,
  ProductRiskLevel,
} from "@/lib/ajax/product-brain/types";

export interface ProductValidationResult {
  riskLevel: ProductRiskLevel;
  violations: string[];
}

/**
 * Validate a product idea for category eligibility and blocked content patterns.
 */
export function validateProductIdea(
  input: ProductBrainInput,
): ProductValidationResult {
  const violations: string[] = [];
  const combinedText = collectProductText(input);

  if (!isAllowedCategory(input.category)) {
    violations.push(
      `Category "${input.category}" is not allowed. Use one of: ${ALLOWED_PRODUCT_CATEGORIES.join(", ")}.`,
    );
  }

  violations.push(...findBlockedContentViolations(combinedText));

  if (isGenericProductTitle(input.title) && hasVagueBuyerLanguage(input.targetBuyer)) {
    violations.push(
      "Product title is too generic and target buyer is not specific enough.",
    );
  }

  const riskLevel = deriveRiskLevel(violations, combinedText);

  return { riskLevel, violations };
}

function deriveRiskLevel(
  violations: string[],
  combinedText: string,
): ProductRiskLevel {
  const blockedPatterns = findBlockedContentViolations(combinedText);
  if (blockedPatterns.length > 0) {
    return "blocked";
  }

  const hasBlockedViolation = violations.some((violation) =>
    BLOCKED_VIOLATION_LABELS.has(violation),
  );
  if (hasBlockedViolation) {
    return "blocked";
  }

  if (violations.length > 0) {
    return "caution";
  }

  return "safe";
}

const BLOCKED_VIOLATION_LABELS = new Set<string>([
  "Medical diagnosis or treatment claims",
  "Legal advice",
  "Financial or investment advice",
  "Copyrighted characters, brands, celebrities, schools, sports teams, or franchises",
  "Guaranteed results",
  "Official form or government document impersonation",
]);
