import type {
  ProductBrainScore,
  ProductBrainValidation,
  ProductBrainVerdict,
} from "@/lib/ajax/product-brain/types";
import type { GenerationStatus } from "@/lib/supabase/schema";

export type { ProductBrainVerdict, ProductBrainScore, ProductBrainValidation };

export type { GenerationStatus };

/** Product Brain fields persisted on `product_ideas`. */
export interface ProductIdeaBrainSnapshot {
  score: ProductBrainScore;
  validation: ProductBrainValidation;
  verdict: ProductBrainVerdict;
  evaluatedAt: string;
}

/** A single printable page within a generated product. */
export interface ProductPageDescription {
  pageNumber: number;
  title: string;
  purpose: string;
  sections: ProductSectionDescription[];
}

export interface ProductSectionDescription {
  id: string;
  heading: string;
  body?: string;
  fields?: ProductFieldDescription[];
}

export interface ProductFieldDescription {
  id: string;
  label: string;
  fieldType: "text" | "checkbox" | "number" | "date" | "notes";
  placeholder?: string;
}

/** JSON document stored in `product_generations.structure`. */
export interface ProductStructure {
  format: string;
  pageCount: number;
  pages: ProductPageDescription[];
  metadata?: Record<string, unknown>;
}

export type ComplianceSeverity = "info" | "warning" | "block";

export interface ComplianceFlag {
  code: string;
  message: string;
  severity: ComplianceSeverity;
  source?: string;
}

export interface LlmRunMetadata {
  provider: string | null;
  model: string | null;
  promptVersion: string | null;
  tokenEstimateInput: number | null;
  tokenEstimateOutput: number | null;
}

export interface PdfAssetPlaceholders {
  storagePath: string | null;
  publicUrl: string | null;
}

/** Forge pipeline generation row (domain). */
export interface ProductGeneration {
  id: string;
  userId: string;
  productIdeaId: string;
  productListingId: string | null;
  structure: ProductStructure;
  llm: LlmRunMetadata;
  generationStatus: GenerationStatus;
  pdf: PdfAssetPlaceholders;
  complianceFlags: ComplianceFlag[];
  complianceWarnings: string[];
  createdAt: string;
  updatedAt: string;
}
