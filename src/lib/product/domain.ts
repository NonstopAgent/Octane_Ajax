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
  /** How the buyer should print, fill, or use this page. */
  userInstructions?: string;
  sections: ProductSectionDescription[];
  metadata?: {
    pageKind?: "cover" | "intro" | "worksheet" | "summary" | "content";
  };
}

export interface ProductTableDescription {
  id?: string;
  headers: string[];
  rowCount?: number;
}

export interface ProductChecklistDescription {
  id?: string;
  title?: string;
  items: string[];
}

export interface ProductSectionDescription {
  id: string;
  heading: string;
  body?: string;
  fields?: ProductFieldDescription[];
  table?: ProductTableDescription;
  checklist?: ProductChecklistDescription;
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

/** Print-on-demand blueprint stored in `product_generations.structure` (Phase 1 pivot). */
export interface PodDetails {
  blueprintId: number;
  printProviderId: number;
  variantIds: number[];
  artworkPrompt: string;
  aestheticStyle: string;
  metadata?: Record<string, unknown>;
}

/** Fulfillment metadata persisted after Printify product creation. */
export interface PodFulfillmentSnapshot {
  artworkUrl?: string | null;
  printifyUploadId?: string | null;
  printifyProductId?: string | null;
  printifyStatus?: "draft" | "published" | null;
  storefrontUrl?: string | null;
  adapterMode?: "demo" | "live" | null;
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

export interface MockupAssetPlaceholders {
  storagePath: string | null;
}

/** Forge pipeline generation row (domain). */
export interface ProductGeneration {
  id: string;
  userId: string;
  productIdeaId: string;
  productListingId: string | null;
  /** Stored in DB `structure` column — POD blueprint from Forge. */
  podDetails: PodDetails;
  llm: LlmRunMetadata;
  generationStatus: GenerationStatus;
  pdf: PdfAssetPlaceholders;
  mockupStoragePath: string | null;
  fulfillment?: PodFulfillmentSnapshot | null;
  complianceFlags: ComplianceFlag[];
  complianceWarnings: string[];
  createdAt: string;
  updatedAt: string;
}
