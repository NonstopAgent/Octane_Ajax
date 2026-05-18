import {
  reviewPhase2Strip,
  reviewQcPanelMuted,
} from "@/components/review/review-panel-styles";
import { ReviewBrainPanel } from "@/components/review/review-brain-panel";
import { ReviewCompliancePanel } from "@/components/review/review-compliance-panel";
import { ReviewPdfPanel } from "@/components/review/review-pdf-panel";
import { ReviewSellabilityPanel } from "@/components/review/review-sellability-panel";
import { ReviewStructurePreview } from "@/components/review/review-structure-preview";
import { hasComplianceRisk } from "@/lib/review/display";
import type { ReviewPhase2Context } from "@/lib/review/types";
import type { ProductIdea } from "@/lib/ajax/types";

type ReviewPhase2SectionProps = {
  phase2: ReviewPhase2Context;
  idea: ProductIdea | null;
};

function isSimulatedDemo(idea: ProductIdea | null): boolean {
  return idea?.rawPayload?.simulated === true;
}

function Phase2EmptyHint({ label }: { label: string }) {
  return (
    <p className="mt-2 text-xs text-[var(--text-muted)]">
      {label}
    </p>
  );
}

export function ReviewPhase2Section({ phase2, idea }: ReviewPhase2SectionProps) {
  const { brain, generation } = phase2;
  const mockMode = isSimulatedDemo(idea);

  const complianceWarnings = generation?.complianceWarnings ?? [];
  const complianceFlags = generation?.complianceFlags ?? [];
  const aiDisclosure =
    typeof generation?.structure.metadata?.aiDisclosure === "string"
      ? generation.structure.metadata.aiDisclosure
      : null;
  const hasCompliance = hasComplianceRisk({
    warnings: complianceWarnings,
    flags: complianceFlags,
  });

  const structure = generation?.structure;
  const showStructure =
    Boolean(structure) &&
    (structure!.pages.length > 0 || structure!.pageCount > 0);

  const showPdf =
    generation ||
    mockMode ||
    Boolean(idea);

  const pdfMockMode = mockMode && !generation?.pdf.storagePath;
  const sellabilityInput = {
    structure: structure ?? null,
    aiDisclosure,
    complianceWarnings,
    complianceFlags,
    generationStatus: generation?.generationStatus ?? "pending",
    pdfStoragePath: generation?.pdf.storagePath,
    mockMode: pdfMockMode,
  } as const;
  const showSellability = showPdf || Boolean(generation) || Boolean(structure);

  const hasAnyPanel =
    brain || hasCompliance || Boolean(aiDisclosure) || showStructure || showPdf;

  if (!hasAnyPanel) {
    return (
      <div
        className={`${reviewPhase2Strip} rounded-md border border-dashed border-[var(--border-dim)] bg-black/15 px-4 py-3`}
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
          Phase 2 QC telemetry
        </p>
        <Phase2EmptyHint label="Product Brain scores and Forge artifacts will appear here after the Phase 2 migration and pipeline run." />
      </div>
    );
  }

  return (
    <div className={`${reviewPhase2Strip} space-y-4`}>
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
        Phase 2 QC telemetry
      </p>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          {brain ? (
            <ReviewBrainPanel brain={brain} />
          ) : (
            <div className={reviewQcPanelMuted}>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
                Product Brain
              </p>
              <Phase2EmptyHint label="No Product Brain evaluation on this idea yet." />
            </div>
          )}

          {aiDisclosure ? (
            <div className={reviewQcPanelMuted}>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--accent-blue)]">
                AI disclosure
              </p>
              <p className="mt-2 text-sm text-[var(--foreground)]">
                {aiDisclosure}
              </p>
            </div>
          ) : null}

          {hasCompliance ? (
            <ReviewCompliancePanel
              warnings={complianceWarnings}
              flags={complianceFlags}
            />
          ) : generation ? (
            <div className={reviewQcPanelMuted}>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
                Compliance
              </p>
              <Phase2EmptyHint label="No compliance warnings detected." />
            </div>
          ) : null}
        </div>

        <div className="space-y-4">
          {showStructure && structure ? (
            <ReviewStructurePreview structure={structure} />
          ) : (
            <div className={reviewQcPanelMuted}>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
                Product structure
              </p>
              <Phase2EmptyHint label="Forge has not persisted a page structure for this listing yet." />
            </div>
          )}

          {showPdf ? (
            <ReviewPdfPanel
              generationId={generation?.id ?? null}
              pdf={
                generation?.pdf ?? {
                  storagePath: null,
                  publicUrl: null,
                }
              }
              generationStatus={sellabilityInput.generationStatus}
              structure={structure ?? null}
              mockMode={pdfMockMode}
            />
          ) : null}

          {showSellability ? (
            <ReviewSellabilityPanel {...sellabilityInput} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
