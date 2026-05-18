import type { ProductGeneration } from "@/lib/product/domain";
import type { GenerationStatus } from "@/lib/supabase/schema";
import {
  evaluateSellabilityChecklist,
  type SellabilityInput,
} from "@/lib/review/sellability";

export class ApprovalBlockedError extends Error {
  readonly code = "APPROVAL_BLOCKED" as const;

  constructor(
    message: string,
    readonly statusCode = 403,
  ) {
    super(message);
    this.name = "ApprovalBlockedError";
  }
}

/** Demo / simulated pipeline — PDF and sellability gates do not block approval. */
export function isDemoReviewBypass(input: {
  ideaRawPayload?: Record<string, unknown> | null;
}): boolean {
  const raw = input.ideaRawPayload;
  if (!raw || typeof raw !== "object") return false;
  if (raw.simulated === true) return true;
  if (raw.cycle === "ajax-demo") return true;
  return false;
}

export function assertPdfReadyForApproval(input: {
  isDemo: boolean;
  generationStatus: GenerationStatus | null | undefined;
  pdfStoragePath: string | null | undefined;
}): void {
  if (input.isDemo) return;

  const status = input.generationStatus;
  const path = input.pdfStoragePath?.trim();

  if (status !== "ready" || !path) {
    throw new ApprovalBlockedError(
      "PDF is not ready yet — wait a moment and try again, or regenerate.",
      403,
    );
  }
}

export function assertSellabilityForApproval(
  sellabilityInput: SellabilityInput,
  isDemo: boolean,
): void {
  if (isDemo) return;

  const checklist = evaluateSellabilityChecklist(sellabilityInput);
  if (checklist.allPassed) return;

  const failedNames = checklist.checks
    .filter((c) => !c.passed)
    .map((c) => c.label);

  throw new ApprovalBlockedError(
    `Sellability checklist has failing items: ${failedNames.join(", ")}`,
    403,
  );
}

export function buildSellabilityInputFromGeneration(
  generation: ProductGeneration | null,
  ideaRawPayload: Record<string, unknown> | null | undefined,
): SellabilityInput {
  const isDemo = isDemoReviewBypass({ ideaRawPayload });
  const pdfMockMode = isDemo && !generation?.pdf.storagePath?.trim();

  return {
    structure: generation?.structure ?? null,
    aiDisclosure:
      typeof generation?.structure.metadata?.aiDisclosure === "string"
        ? generation.structure.metadata.aiDisclosure
        : null,
    complianceWarnings: generation?.complianceWarnings ?? [],
    complianceFlags: generation?.complianceFlags ?? [],
    generationStatus: generation?.generationStatus ?? "pending",
    pdfStoragePath: generation?.pdf.storagePath,
    mockMode: pdfMockMode,
  };
}
