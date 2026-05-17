import type { ProductBrainVerdict } from "@/lib/ajax/product-brain/types";
import type { ComplianceFlag, ProductBrainScore } from "@/lib/product/domain";

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

  for (const flag of input.flags) {
    const trimmed = flag.message.trim();
    if (trimmed) {
      items.push({ message: trimmed, severity: flag.severity });
    }
  }

  return items;
}