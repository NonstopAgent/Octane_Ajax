import type { ProductBrainVerdict } from "@/lib/ajax/product-brain/types";
import type { ComplianceFlag, ProductBrainScore } from "@/lib/product/domain";
import type { GenerationStatus } from "@/lib/supabase/schema";

export function formatBrainVerdictLabel(verdict: ProductBrainVerdict): string {
  switch (verdict) {
    case "approve_for_generation":
      return "Approve for generation";
    case "needs_revision":
      return "Needs revision";
    case "blocked":
      return "Blocked";
    default:
      return verdict;
  }
}

export function brainVerdictTone(
  verdict: ProductBrainVerdict,
): "blue" | "orange" | "warning" | "neutral" {
  switch (verdict) {
    case "approve_for_generation":
      return "blue";
    case "needs_revision":
      return "warning";
    case "blocked":
      return "orange";
    default:
      return "neutral";
  }
}

export function formatRiskLevel(
  risk: "safe" | "caution" | "blocked",
): { label: string; tone: "blue" | "warning" | "orange" } {
  switch (risk) {
    case "safe":
      return { label: "Safe", tone: "blue" };
    case "caution":
      return { label: "Caution", tone: "warning" };
    case "blocked":
      return { label: "Blocked", tone: "orange" };
    default:
      return { label: risk, tone: "neutral" as "blue" };
  }
}

export const BRAIN_SCORE_DIMENSIONS: {
  key: keyof ProductBrainScore;
  label: string;
  invert?: boolean;
}[] = [
  { key: "urgency", label: "Urgency" },
  { key: "specificity", label: "Specificity" },
  { key: "buyerClarity", label: "Buyer clarity" },
  { key: "usefulness", label: "Usefulness" },
  { key: "competitionRisk", label: "Competition", invert: true },
  { key: "complianceRisk", label: "Compliance", invert: true },
];

export function scoreBarPercent(value: number, invert?: boolean): number {
  const clamped = Math.max(0, Math.min(100, value));
  return invert ? 100 - clamped : clamped;
}

export const AI_DISCLOSURE_FLAG_CODE = "ai_disclosure";

/** Compliance flags only — AI disclosure is shown in its own panel. */
export function filterComplianceFlags(flags: ComplianceFlag[]): ComplianceFlag[] {
  return flags.filter((flag) => flag.code !== AI_DISCLOSURE_FLAG_CODE);
}

export function hasComplianceRisk(input: {
  warnings: string[];
  flags: ComplianceFlag[];
}): boolean {
  const trimmedWarnings = input.warnings.map((w) => w.trim()).filter(Boolean);
  const riskFlags = filterComplianceFlags(input.flags);
  return trimmedWarnings.length > 0 || riskFlags.length > 0;
}

export type ReviewApproveUi = {
  label: string;
  disabled: boolean;
  disabledReason: string | null;
  cautionMessage: string | null;
  tone: "approve" | "caution";
};

export function getReviewApproveUi(
  brainVerdict: ProductBrainVerdict | null | undefined,
  options?: { sellabilityAllPassed?: boolean },
): ReviewApproveUi {
  if (brainVerdict === "blocked") {
    return {
      label: "Approve",
      disabled: true,
      disabledReason: "Blocked products cannot be approved.",
      cautionMessage: null,
      tone: "approve",
    };
  }

  if (options?.sellabilityAllPassed === false) {
    const blocked: ReviewApproveUi = {
      label:
        brainVerdict === "needs_revision" ? "Approve with Caution" : "Approve",
      disabled: true,
      disabledReason: "Fix sellability issues before approving.",
      cautionMessage: null,
      tone: brainVerdict === "needs_revision" ? "caution" : "approve",
    };
    if (brainVerdict === "needs_revision") {
      blocked.cautionMessage =
        "This product passed safety checks but needs operator review before approval.";
    }
    return blocked;
  }

  if (brainVerdict === "needs_revision") {
    return {
      label: "Approve with Caution",
      disabled: false,
      disabledReason: null,
      cautionMessage:
        "This product passed safety checks but needs operator review before approval.",
      tone: "caution",
    };
  }

  return {
    label: "Approve",
    disabled: false,
    disabledReason: null,
    cautionMessage: null,
    tone: "approve",
  };
}

export type ReviewPdfUiState = "download" | "placeholder" | "failed";

export function getReviewPdfUiState(input: {
  generationStatus: GenerationStatus;
  storagePath: string | null | undefined;
  mockMode?: boolean;
}): ReviewPdfUiState {
  if (input.mockMode) return "placeholder";
  if (input.generationStatus === "failed") return "failed";
  if (
    input.generationStatus === "ready" &&
    Boolean(input.storagePath?.trim())
  ) {
    return "download";
  }
  return "placeholder";
}

export function buildProductPdfDownloadHref(generationId: string): string {
  return `/api/ajax/product-generations/${generationId}/pdf-download`;
}

export function buildProductPdfGenerateHref(generationId: string): string {
  return `/api/ajax/product-generations/${generationId}/generate-pdf`;
}

export function collectComplianceMessages(input: {
  warnings: string[];
  flags: ComplianceFlag[];
}): { message: string; severity: ComplianceFlag["severity"] }[] {
  const items: { message: string; severity: ComplianceFlag["severity"] }[] =
    [];

  for (const warning of input.warnings) {
    const trimmed = warning.trim();
    if (trimmed) items.push({ message: trimmed, severity: "warning" });
  }

  for (const flag of filterComplianceFlags(input.flags)) {
    const trimmed = flag.message.trim();
    if (trimmed) {
      items.push({ message: trimmed, severity: flag.severity });
    }
  }

  return items;
}