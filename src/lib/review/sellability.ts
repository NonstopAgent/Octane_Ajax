import type {
  ComplianceFlag,
  ProductPageDescription,
  ProductStructure,
} from "@/lib/product/domain";
import type { GenerationStatus } from "@/lib/supabase/schema";
import {
  getReviewPdfUiState,
  hasComplianceRisk,
} from "@/lib/review/display";

export type SellabilityCheckId =
  | "min_six_pages"
  | "cover_page"
  | "instructions_page"
  | "worksheet_pages"
  | "summary_page"
  | "ai_disclosure"
  | "no_compliance_warnings"
  | "pdf_ready";

export type SellabilityCheckItem = {
  id: SellabilityCheckId;
  label: string;
  passed: boolean;
  detail: string | null;
};

export type SellabilityChecklist = {
  checks: SellabilityCheckItem[];
  passedCount: number;
  totalCount: number;
  allPassed: boolean;
};

export type SellabilityInput = {
  structure: ProductStructure | null;
  aiDisclosure: string | null | undefined;
  complianceWarnings: string[];
  complianceFlags: ComplianceFlag[];
  generationStatus: GenerationStatus;
  pdfStoragePath: string | null | undefined;
  mockMode?: boolean;
};

type DomainPageKind =
  | "cover"
  | "intro"
  | "worksheet"
  | "summary"
  | "content";

const MIN_SELLABLE_PAGES = 6;
const MIN_WORKSHEET_PAGES = 2;

function resolvePageKind(
  page: ProductPageDescription,
  index: number,
  total: number,
): DomainPageKind {
  const metaKind = page.metadata?.pageKind;
  if (
    metaKind === "cover" ||
    metaKind === "intro" ||
    metaKind === "worksheet" ||
    metaKind === "summary" ||
    metaKind === "content"
  ) {
    return metaKind;
  }

  const haystack = `${page.title} ${page.purpose}`.toLowerCase();
  if (index === 0 && /cover|title\s*page|front/.test(haystack)) return "cover";
  if (/how\s*to|instruction|getting\s*started|overview|orient/.test(haystack)) {
    return "intro";
  }
  if (
    index === total - 1 &&
    /summary|review|reflection|wrap[- ]?up|next\s*steps/.test(haystack)
  ) {
    return "summary";
  }
  if (index === 0 && total <= 3) return "content";
  if (index === 0) return "cover";
  if (index === 1 && total >= 4) return "intro";
  if (index === total - 1 && total >= 4) return "summary";
  return "worksheet";
}

function pageKinds(structure: ProductStructure): DomainPageKind[] {
  return structure.pages.map((page, index) =>
    resolvePageKind(page, index, structure.pages.length),
  );
}

function countPagesOfKind(
  structure: ProductStructure,
  kind: DomainPageKind,
): number {
  return pageKinds(structure).filter((k) => k === kind).length;
}

export function evaluateSellabilityChecklist(
  input: SellabilityInput,
): SellabilityChecklist {
  const structure = input.structure;
  const pageCount = structure?.pages.length ?? structure?.pageCount ?? 0;
  const coverCount = structure ? countPagesOfKind(structure, "cover") : 0;
  const introCount = structure ? countPagesOfKind(structure, "intro") : 0;
  const worksheetCount = structure
    ? countPagesOfKind(structure, "worksheet")
    : 0;
  const summaryCount = structure ? countPagesOfKind(structure, "summary") : 0;

  const aiText =
    typeof input.aiDisclosure === "string" ? input.aiDisclosure.trim() : "";
  const complianceClear = !hasComplianceRisk({
    warnings: input.complianceWarnings,
    flags: input.complianceFlags,
  });
  const pdfReady =
    getReviewPdfUiState({
      generationStatus: input.generationStatus,
      storagePath: input.pdfStoragePath,
      mockMode: input.mockMode,
    }) === "download";

  const checks: SellabilityCheckItem[] = [
    {
      id: "min_six_pages",
      label: "6+ pages",
      passed: pageCount >= MIN_SELLABLE_PAGES,
      detail: structure
        ? `${pageCount} page${pageCount === 1 ? "" : "s"}`
        : "Structure not loaded",
    },
    {
      id: "cover_page",
      label: "Cover page",
      passed: coverCount > 0,
      detail: structure
        ? coverCount > 0
          ? "Cover page present"
          : "No cover page detected"
        : "Structure not loaded",
    },
    {
      id: "instructions_page",
      label: "Instructions page",
      passed: introCount > 0,
      detail: structure
        ? introCount > 0
          ? "How-to / instructions page present"
          : "No instructions page detected"
        : "Structure not loaded",
    },
    {
      id: "worksheet_pages",
      label: "Worksheet / template pages",
      passed: worksheetCount >= MIN_WORKSHEET_PAGES,
      detail: structure
        ? worksheetCount >= MIN_WORKSHEET_PAGES
          ? `${worksheetCount} worksheet pages`
          : `${worksheetCount} worksheet page${worksheetCount === 1 ? "" : "s"} — need ${MIN_WORKSHEET_PAGES}+`
        : "Structure not loaded",
    },
    {
      id: "summary_page",
      label: "Summary / review page",
      passed: summaryCount > 0,
      detail: structure
        ? summaryCount > 0
          ? "Summary or review page present"
          : "No summary page detected"
        : "Structure not loaded",
    },
    {
      id: "ai_disclosure",
      label: "AI disclosure present",
      passed: aiText.length > 0,
      detail:
        aiText.length > 0
          ? "Disclosure copy on file"
          : "Missing AI disclosure in generation metadata",
    },
    {
      id: "no_compliance_warnings",
      label: "No compliance warnings",
      passed: complianceClear,
      detail: complianceClear
        ? "No policy warnings or flags"
        : "Compliance warnings or flags require review",
    },
    {
      id: "pdf_ready",
      label: "PDF ready",
      passed: pdfReady,
      detail: pdfReady
        ? "Generation complete with stored PDF"
        : input.generationStatus === "failed"
          ? "PDF generation failed"
          : input.generationStatus === "generating" ||
              input.generationStatus === "queued"
            ? "PDF still generating"
            : input.mockMode
              ? "Demo mode — no printable file"
              : "PDF not ready or storage path missing",
    },
  ];

  const passedCount = checks.filter((c) => c.passed).length;

  return {
    checks,
    passedCount,
    totalCount: checks.length,
    allPassed: passedCount === checks.length,
  };
}
