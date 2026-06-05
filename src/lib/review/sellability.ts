import type {
  ComplianceFlag,
  PodDetails,
  PodFulfillmentSnapshot,
} from "@/lib/product/domain";
import type { GenerationStatus } from "@/lib/supabase/schema";
import { hasComplianceRisk } from "@/lib/review/display";

export type SellabilityCheckId =
  | "pod_blueprint"
  | "pod_artwork_prompt"
  | "pod_aesthetic_style"
  | "pod_variants"
  | "ai_disclosure"
  | "no_compliance_warnings"
  | "fulfillment_ready";

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
  podDetails: PodDetails | null;
  fulfillment: PodFulfillmentSnapshot | null;
  aiDisclosure: string | null | undefined;
  complianceWarnings: string[];
  complianceFlags: ComplianceFlag[];
  generationStatus: GenerationStatus;
  mockMode?: boolean;
};

function fulfillmentReady(input: SellabilityInput): boolean {
  if (input.mockMode) return true;
  if (input.generationStatus !== "ready") return false;
  return Boolean(input.fulfillment?.printifyProductId?.trim());
}

export function evaluateSellabilityChecklist(
  input: SellabilityInput,
): SellabilityChecklist {
  const pod = input.podDetails;
  const aiText =
    typeof input.aiDisclosure === "string" ? input.aiDisclosure.trim() : "";
  const complianceClear = !hasComplianceRisk({
    warnings: input.complianceWarnings,
    flags: input.complianceFlags,
  });
  const ready = fulfillmentReady(input);

  const checks: SellabilityCheckItem[] = [
    {
      id: "pod_blueprint",
      label: "Printify blueprint",
      passed: Boolean(pod?.blueprintId && pod?.printProviderId),
      detail: pod
        ? `Blueprint ${pod.blueprintId}, provider ${pod.printProviderId}`
        : "POD details not loaded",
    },
    {
      id: "pod_artwork_prompt",
      label: "Artwork prompt",
      passed: Boolean(pod?.artworkPrompt && pod.artworkPrompt.length >= 20),
      detail: pod?.artworkPrompt
        ? `${pod.artworkPrompt.length} chars`
        : "Missing artwork prompt",
    },
    {
      id: "pod_aesthetic_style",
      label: "IP-safe aesthetic style",
      passed: Boolean(pod?.aestheticStyle?.trim()),
      detail: pod?.aestheticStyle ?? "Missing aesthetic style",
    },
    {
      id: "pod_variants",
      label: "Printify variants",
      passed: (pod?.variantIds.length ?? 0) >= 1,
      detail: pod
        ? `${pod.variantIds.length} variant(s)`
        : "No variants configured",
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
      id: "fulfillment_ready",
      label: "Printify draft ready",
      passed: ready,
      detail: ready
        ? "Printify product draft created"
        : input.generationStatus === "failed"
          ? "POD fulfillment failed"
          : input.generationStatus === "generating" ||
              input.generationStatus === "queued"
            ? "POD fulfillment still running"
            : input.mockMode
              ? "Demo mode — fulfillment simulated"
              : "Printify product not ready",
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
