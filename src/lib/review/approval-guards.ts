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

/** Demo / simulated pipeline — fulfillment and sellability gates do not block approval. */
export function isDemoReviewBypass(input: {
  ideaRawPayload?: Record<string, unknown> | null;
}): boolean {
  const raw = input.ideaRawPayload;
  if (!raw || typeof raw !== "object") return false;
  if (raw.simulated === true) return true;
  if (raw.cycle === "ajax-demo") return true;
  return false;
}

export function assertFulfillmentReadyForApproval(input: {
  isDemo: boolean;
  generationStatus: GenerationStatus | null | undefined;
  printifyProductId: string | null | undefined;
}): void {
  if (input.isDemo) return;

  const status = input.generationStatus;
  const productId = input.printifyProductId?.trim();

  if (status !== "ready" || !productId) {
    throw new ApprovalBlockedError(
      "Printify product draft is not ready yet — wait a moment and try again.",
      403,
    );
  }
}

/** Alias for POD pipeline approval gate. */
export const assertPodReadyForApproval = assertFulfillmentReadyForApproval;

/** @deprecated Use assertFulfillmentReadyForApproval for POD pipeline. */
export function assertPdfReadyForApproval(input: {
  isDemo: boolean;
  generationStatus: GenerationStatus | null | undefined;
  pdfStoragePath: string | null | undefined;
}): void {
  assertFulfillmentReadyForApproval({
    isDemo: input.isDemo,
    generationStatus: input.generationStatus,
    printifyProductId: input.pdfStoragePath,
  });
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
  const fulfillmentMockMode =
    isDemo && !generation?.fulfillment?.printifyProductId?.trim();

  return {
    podDetails: generation?.podDetails ?? null,
    fulfillment: generation?.fulfillment ?? null,
    aiDisclosure:
      typeof generation?.podDetails.metadata?.aiDisclosure === "string"
        ? generation.podDetails.metadata.aiDisclosure
        : null,
    complianceWarnings: generation?.complianceWarnings ?? [],
    complianceFlags: generation?.complianceFlags ?? [],
    generationStatus: generation?.generationStatus ?? "pending",
    mockMode: fulfillmentMockMode,
  };
}
