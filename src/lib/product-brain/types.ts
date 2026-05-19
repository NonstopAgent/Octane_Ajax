/**
 * Input for evaluating a product idea against Octane Ajax strategy rules.
 * Mirrors the product_ideas table with evaluation-relevant fields.
 */
export type ProductIdeaInput = {
  niche?: string | null;
  title?: string | null;
  description?: string | null;
  seo_keywords?: string[];
  trend_score?: number;
  source?: string;
};

/** Score breakdown across evaluation dimensions. */
export type BrainScore = {
  /** 0–25: Specificity of target audience + problem */
  specificity: number;
  /** 0–25: Alignment with printable/utility format requirement */
  format_fit: number;
  /** 0–25: Absence of blocked-category signals */
  compliance: number;
  /** 0–25: Estimated demand based on keywords + trend score */
  demand: number;
  /** Sum of all dimensions (0–100) */
  total: number;
};

/**
 * Flags for each blocked-content category from AGENTS.md.
 * A `true` value means the idea triggered that category's rules.
 */
export type ComplianceFlags = {
  medical: boolean;
  legal: boolean;
  financial: boolean;
  ip_brand: boolean;
  misleading: boolean;
  impersonation: boolean;
};

/** Detailed validation result for a single idea. */
export type BrainValidation = {
  compliance_flags: ComplianceFlags;
  compliance_warnings: string[];
  strengths: string[];
  weaknesses: string[];
};

/** Final verdict from the Product Brain. */
export type BrainVerdict = "strong" | "viable" | "weak" | "blocked";

/** Complete evaluation result returned by evaluateIdea(). */
export type BrainEvaluation = {
  score: BrainScore;
  validation: BrainValidation;
  verdict: BrainVerdict;
  evaluated_at: string;
};
