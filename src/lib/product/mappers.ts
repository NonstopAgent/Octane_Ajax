import type {
  ProductBrainScore,
  ProductBrainValidation,
  ProductBrainVerdict,
} from "@/lib/ajax/product-brain/types";
import type {
  Json,
  ProductGeneration as DbGeneration,
  ProductIdea as DbIdea,
  TablesInsert,
  TablesUpdate,
} from "@/lib/supabase/database.types";
import {
  GENERATION_STATUSES,
  PRODUCT_BRAIN_VERDICTS,
  type GenerationStatus,
  type ProductBrainVerdictDb,
} from "@/lib/supabase/schema";
import type {
  ComplianceFlag,
  ComplianceSeverity,
  ProductGeneration,
  ProductIdeaBrainSnapshot,
  ProductStructure,
} from "@/lib/product/domain";

function toJson<T>(value: T): Json {
  return value as unknown as Json;
}

const EMPTY_STRUCTURE: ProductStructure = {
  format: "unknown",
  pageCount: 0,
  pages: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProductBrainVerdict(value: unknown): value is ProductBrainVerdict {
  return (
    typeof value === "string" &&
    (PRODUCT_BRAIN_VERDICTS as readonly string[]).includes(value)
  );
}

function isGenerationStatus(value: unknown): value is GenerationStatus {
  return (
    typeof value === "string" &&
    (GENERATION_STATUSES as readonly string[]).includes(value)
  );
}

function isComplianceSeverity(value: unknown): value is ComplianceSeverity {
  return value === "info" || value === "warning" || value === "block";
}

function parseProductBrainScore(raw: unknown): ProductBrainScore | null {
  if (!isRecord(raw)) return null;
  const fields = [
    "urgency",
    "specificity",
    "buyerClarity",
    "usefulness",
    "competitionRisk",
    "complianceRisk",
    "totalScore",
  ] as const;
  if (!fields.every((key) => typeof raw[key] === "number")) return null;
  return {
    urgency: raw.urgency as number,
    specificity: raw.specificity as number,
    buyerClarity: raw.buyerClarity as number,
    usefulness: raw.usefulness as number,
    competitionRisk: raw.competitionRisk as number,
    complianceRisk: raw.complianceRisk as number,
    totalScore: raw.totalScore as number,
  };
}

function parseProductBrainValidation(
  raw: unknown,
): ProductBrainValidation | null {
  if (!isRecord(raw)) return null;
  if (raw.riskLevel !== "safe" && raw.riskLevel !== "caution" && raw.riskLevel !== "blocked") {
    return null;
  }
  if (!Array.isArray(raw.violations)) return null;
  if (!raw.violations.every((v) => typeof v === "string")) return null;
  return {
    riskLevel: raw.riskLevel,
    violations: raw.violations as string[],
  };
}

function parseProductStructure(raw: unknown): ProductStructure {
  if (!isRecord(raw)) return EMPTY_STRUCTURE;
  const pages = Array.isArray(raw.pages) ? raw.pages : [];
  return {
    format: typeof raw.format === "string" ? raw.format : "unknown",
    pageCount: typeof raw.pageCount === "number" ? raw.pageCount : pages.length,
    pages: pages as ProductStructure["pages"],
    metadata: isRecord(raw.metadata) ? raw.metadata : undefined,
  };
}

function parseComplianceFlags(raw: unknown): ComplianceFlag[] {
  if (!Array.isArray(raw)) return [];
  const flags: ComplianceFlag[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    if (typeof item.code !== "string" || typeof item.message !== "string") continue;
    const severity = isComplianceSeverity(item.severity) ? item.severity : "warning";
    flags.push({
      code: item.code,
      message: item.message,
      severity,
      source: typeof item.source === "string" ? item.source : undefined,
    });
  }
  return flags;
}

/** Read Product Brain columns from a `product_ideas` row. */
export function mapIdeaBrainFromDb(row: DbIdea): ProductIdeaBrainSnapshot | null {
  if (!row.brain_verdict || !isProductBrainVerdict(row.brain_verdict)) return null;
  const score = parseProductBrainScore(row.brain_score);
  const validation = parseProductBrainValidation(row.brain_validation);
  if (!score || !validation || !row.brain_evaluated_at) return null;
  return {
    score,
    validation,
    verdict: row.brain_verdict,
    evaluatedAt: row.brain_evaluated_at,
  };
}

/** Persist Product Brain evaluation onto `product_ideas`. */
export function mapIdeaBrainToDbUpdate(
  snapshot: ProductIdeaBrainSnapshot,
): Pick<
  TablesUpdate<"product_ideas">,
  "brain_score" | "brain_validation" | "brain_verdict" | "brain_evaluated_at"
> {
  return {
    brain_score: toJson(snapshot.score),
    brain_validation: toJson(snapshot.validation),
    brain_verdict: snapshot.verdict as ProductBrainVerdictDb,
    brain_evaluated_at: snapshot.evaluatedAt,
  };
}

export function mapGenerationFromDb(row: DbGeneration): ProductGeneration {
  const status = isGenerationStatus(row.generation_status)
    ? row.generation_status
    : "pending";

  return {
    id: row.id,
    userId: row.user_id,
    productIdeaId: row.product_idea_id,
    productListingId: row.product_listing_id,
    structure: parseProductStructure(row.structure),
    llm: {
      provider: row.llm_provider,
      model: row.llm_model,
      promptVersion: row.prompt_version,
      tokenEstimateInput: row.token_estimate_input,
      tokenEstimateOutput: row.token_estimate_output,
    },
    generationStatus: status,
    pdf: {
      storagePath: row.pdf_storage_path,
      publicUrl: row.pdf_public_url,
    },
    complianceFlags: parseComplianceFlags(row.compliance_flags),
    complianceWarnings: row.compliance_warnings ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapGenerationToDbInsert(
  input: Pick<
    ProductGeneration,
    | "productIdeaId"
    | "productListingId"
    | "structure"
    | "llm"
    | "generationStatus"
    | "pdf"
    | "complianceFlags"
    | "complianceWarnings"
  > & { userId?: string },
): TablesInsert<"product_generations"> {
  return {
    user_id: input.userId,
    product_idea_id: input.productIdeaId,
    product_listing_id: input.productListingId,
    structure: toJson(input.structure),
    llm_provider: input.llm.provider,
    llm_model: input.llm.model,
    prompt_version: input.llm.promptVersion,
    token_estimate_input: input.llm.tokenEstimateInput,
    token_estimate_output: input.llm.tokenEstimateOutput,
    generation_status: input.generationStatus,
    pdf_storage_path: input.pdf.storagePath,
    pdf_public_url: input.pdf.publicUrl,
    compliance_flags: toJson(input.complianceFlags),
    compliance_warnings: input.complianceWarnings,
  };
}

export function mapGenerationToDbUpdate(
  patch: Partial<
    Pick<
      ProductGeneration,
      | "productListingId"
      | "structure"
      | "llm"
      | "generationStatus"
      | "pdf"
      | "complianceFlags"
      | "complianceWarnings"
    >
  >,
): TablesUpdate<"product_generations"> {
  const update: TablesUpdate<"product_generations"> = {};

  if (patch.productListingId !== undefined) {
    update.product_listing_id = patch.productListingId;
  }
  if (patch.structure !== undefined) {
    update.structure = toJson(patch.structure);
  }
  if (patch.llm) {
    if (patch.llm.provider !== undefined) update.llm_provider = patch.llm.provider;
    if (patch.llm.model !== undefined) update.llm_model = patch.llm.model;
    if (patch.llm.promptVersion !== undefined) {
      update.prompt_version = patch.llm.promptVersion;
    }
    if (patch.llm.tokenEstimateInput !== undefined) {
      update.token_estimate_input = patch.llm.tokenEstimateInput;
    }
    if (patch.llm.tokenEstimateOutput !== undefined) {
      update.token_estimate_output = patch.llm.tokenEstimateOutput;
    }
  }
  if (patch.generationStatus !== undefined) {
    update.generation_status = patch.generationStatus;
  }
  if (patch.pdf) {
    if (patch.pdf.storagePath !== undefined) {
      update.pdf_storage_path = patch.pdf.storagePath;
    }
    if (patch.pdf.publicUrl !== undefined) {
      update.pdf_public_url = patch.pdf.publicUrl;
    }
  }
  if (patch.complianceFlags !== undefined) {
    update.compliance_flags = toJson(patch.complianceFlags);
  }
  if (patch.complianceWarnings !== undefined) {
    update.compliance_warnings = patch.complianceWarnings;
  }

  return update;
}
