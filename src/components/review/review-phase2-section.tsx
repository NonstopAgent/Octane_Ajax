import {
  reviewPhase2Strip,
  reviewQcPanelMuted,
} from "@/components/review/review-panel-styles";
import { ReviewBrainPanel } from "@/components/review/review-brain-panel";
import { ReviewCompliancePanel } from "@/components/review/review-compliance-panel";
import { ReviewPdfPanel } from "@/components/review/review-pdf-panel";
import { ReviewSellabilityPanel } from "@/components/review/review-sellability-panel";
import { hasComplianceRisk } from "@/lib/review/display";
import type { ReviewPhase2Context } from "@/lib/review/types";
import type { ProductIdea } from "@/lib/ajax/types";
import type { GenerationStatus } from "@/lib/supabase/schema";

type ReviewPhase2SectionProps = {
  phase2: ReviewPhase2Context;
  idea: ProductIdea | null;
  onGenerationChange?: (patch: {
    generationStatus: GenerationStatus;
    storagePath?: string | null;
  }) => void;
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

export function ReviewPhase2Section({
  phase2,
  idea,
  onGenerationChange,
}: ReviewPhase2SectionProps) {
  const { brain, generation } = phase2;
  const mockMode = isSimulatedDemo(idea);

  const complianceWarnings = generation?.complianceWarnings ?? [];
  const complianceFlags = generation?.complianceFlags ?? [];
  const podDetails = generation?.podDetails;
  const aiDisclosure =
    typeof podDetails?.metadata?.aiDisclosure === "string"
      ? podDetails.metadata.aiDisclosure
      : null;
  const hasCompliance = hasComplianceRisk({
    warnings: complianceWarnings,
    flags: complianceFlags,
  });

  const showPodDetails = Boolean(
    podDetails &&
      podDetails.blueprintId > 0 &&
      podDetails.artworkPrompt.trim(),
  );

  const showAssetPanel =
    generation ||
    mockMode ||
    Boolean(idea);

  const podMockMode =
    mockMode && !generation?.fulfillment?.printifyProductId?.trim();
  const sellabilityInput = {
    podDetails: podDetails ?? null,
    fulfillment: generation?.fulfillment ?? null,
    aiDisclosure,
    complianceWarnings,
    complianceFlags,
    generationStatus: generation?.generationStatus ?? "pending",
    mockMode: podMockMode,
  } as const;
  const showSellability =
    showAssetPanel || Boolean(generation) || showPodDetails;

  const hasAnyPanel =
    brain || hasCompliance || Boolean(aiDisclosure) || showPodDetails || showAssetPanel;

  if (!hasAnyPanel) {
    return (
      <div
        className={`${reviewPhase2Strip} rounded-md border border-dashed border-[var(--border-dim)] bg-black/15 px-4 py-3`}
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
          Phase 2 QC telemetry
        </p>
        <Phase2EmptyHint label="Product Brain scores and Forge artifacts will appear here after the pipeline run." />
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
          {showPodDetails && podDetails ? (
            <div className={reviewQcPanelMuted}>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
                POD blueprint
              </p>
              <dl className="mt-2 space-y-1 text-xs text-[var(--foreground)]">
                <div>
                  <dt className="text-[var(--text-muted)]">Blueprint</dt>
                  <dd>{podDetails.blueprintId}</dd>
                </div>
                <div>
                  <dt className="text-[var(--text-muted)]">Style</dt>
                  <dd>{podDetails.aestheticStyle}</dd>
                </div>
                <div>
                  <dt className="text-[var(--text-muted)]">Variants</dt>
                  <dd>{podDetails.variantIds.join(", ")}</dd>
                </div>
                <div>
                  <dt className="text-[var(--text-muted)]">Artwork prompt</dt>
                  <dd className="text-[var(--text-muted)]">
                    {podDetails.artworkPrompt.slice(0, 120)}
                    {podDetails.artworkPrompt.length > 120 ? "…" : ""}
                  </dd>
                </div>
              </dl>
            </div>
          ) : (
            <div className={reviewQcPanelMuted}>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
                POD blueprint
              </p>
              <Phase2EmptyHint label="Forge has not persisted POD details for this listing yet." />
            </div>
          )}

          {showAssetPanel ? (
            <ReviewPdfPanel
              generationId={generation?.id ?? null}
              pdf={
                generation?.pdf ?? {
                  storagePath: null,
                  publicUrl: null,
                }
              }
              mockupStoragePath={generation?.mockupStoragePath ?? null}
              generationStatus={sellabilityInput.generationStatus}
              structure={null}
              mockMode={podMockMode}
              onGenerationChange={onGenerationChange}
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
