export type ProductFormat =
  | "mug"
  | "poster"
  | "art_print"
  | "tshirt"
  | "sweatshirt"
  | "tote_bag"
  | "phone_case";

export type ProductRiskLevel = "safe" | "caution" | "blocked";

export type ProductCategory =
  | "education"
  | "productivity"
  | "small_business"
  | "home_organization"
  | "wellness_tracking"
  | "parenting_support"
  | "student_tools"
  | "creator_tools"
  | "pet_lovers"
  | "occupation_gifts"
  | "hobby_leisure"
  | "humor_novelty"
  | "seasonal_holiday";

export type ProductBrainVerdict =
  | "approve_for_generation"
  | "needs_revision"
  | "blocked";

export interface ProductBrainInput {
  title: string;
  niche: string;
  targetBuyer: string;
  problemSolved: string;
  format: ProductFormat;
  category: ProductCategory;
  description: string;
  keywords: string[];
}

export interface ProductBrainScore {
  urgency: number;
  specificity: number;
  buyerClarity: number;
  usefulness: number;
  competitionRisk: number;
  complianceRisk: number;
  totalScore: number;
}

export interface ProductBrainValidation {
  riskLevel: ProductRiskLevel;
  violations: string[];
}
