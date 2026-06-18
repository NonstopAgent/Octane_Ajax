"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { GenerationStatus } from "@/lib/supabase/schema";
import type { PdfAssetPlaceholders, ProductStructure } from "@/lib/product/domain";
import {
  buildProductMockupDownloadHref,
  buildProductPdfDownloadHref,
  getReviewPdfUiState,
} from "@/lib/review/display";
import {
  pdfPreviewIcon,
  pdfPreviewSlot,
  reviewQcPanel,
} from "@/components/review/review-panel-styles";
import { StatusBadge } from "@/components/ui/status-badge";

type ReviewPdfPanelProps = {
  generationId: string | null;
  pdf: PdfAssetPlaceholders;
  mockupStoragePath?: string | null;
  generationStatus: GenerationStatus;
  structure?: ProductStructure | null;
  mockMode?: boolean;
  onGenerationChange?: (patch: {
    generationStatus: GenerationStatus;
    storagePath?: string | null;
  }) => void;
};

function statusLabel(status: GenerationStatus): string {
  switch (status) {
    case "ready":
      return "Assets ready";
    case "generating":
      return "Generating";
    case "queued":
      return "Queued";
    case "failed":
      return "Failed";
    default:
      return "Pending";
  }
}

function statusTone(
  status: GenerationStatus,
): "blue" | "orange" | "warning" | "neutral" {
  if (status === "ready") return "blue";
  if (status === "failed") return "orange";
  if (status === "generating" || status === "queued") return "warning";
  return "neutral";
}

/**
 * Product asset panel — shows the generated artwork/mockup and POD
 * fulfillment status. Artwork + Printify draft creation run automatically
 * after Forge; there is no manual generate action.
 *
 * (Legacy PDF downloads remain available for old digital-download listings.)
 */
export function ReviewPdfPanel({
  generationId,
  pdf,
  mockupStoragePath = null,
  generationStatus,
  mockMode = false,
  onGenerationChange,
}: ReviewPdfPanelProps) {
  const router = useRouter();
  const startedRef = useRef(false);

  // Drive artwork + Printify fulfillment to completion from the Review Gate.
  // The work runs in its own /fulfill invocation (full serverless budget), so a
  // 'queued' or stale 'generating' listing finishes instead of hanging forever.
  useEffect(() => {
    if (mockMode || !generationId) return;
    if (generationStatus !== "queued" && generationStatus !== "generating") {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const endpoint = `/api/ajax/product-generations/${generationId}/fulfill`;

    const poll = async () => {
      try {
        const res = await fetch(endpoint, { credentials: "include" });
        const data = (await res.json().catch(() => ({}))) as {
          generationStatus?: GenerationStatus;
        };
        if (
          !cancelled &&
          (data.generationStatus === "ready" ||
            data.generationStatus === "failed")
        ) {
          onGenerationChange?.({ generationStatus: data.generationStatus });
          router.refresh();
          return;
        }
      } catch {
        // transient network error — keep polling
      }
      if (!cancelled) timer = setTimeout(poll, 3000);
    };

    // Kick off fulfillment once per mounted panel, then poll for completion.
    if (!startedRef.current) {
      startedRef.current = true;
      void fetch(endpoint, { method: "POST", credentials: "include" }).catch(
        () => {},
      );
    }
    timer = setTimeout(poll, 3000);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [generationId, generationStatus, mockMode, onGenerationChange, router]);

  const uiState = getReviewPdfUiState({
    generationStatus,
    storagePath: pdf.storagePath,
    mockMode,
  });

  // Legacy digital-download listings only — POD listings have no PDF.
  const legacyPdfHref =
    generationId && uiState === "download" && pdf.storagePath?.trim()
      ? buildProductPdfDownloadHref(generationId)
      : null;

  const mockupHref =
    generationId && mockupStoragePath?.trim()
      ? buildProductMockupDownloadHref(generationId)
      : null;

  const generating =
    !mockMode &&
    Boolean(generationId) &&
    (generationStatus === "generating" || generationStatus === "queued");

  return (
    <section className={reviewQcPanel} aria-labelledby="review-asset-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          id="review-asset-heading"
          className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--accent-blue)]"
        >
          Product assets
        </p>
        <StatusBadge
          label={statusLabel(generationStatus)}
          tone={statusTone(generationStatus)}
        />
      </div>

      <div className={pdfPreviewSlot}>
        {mockupHref ? (
          <div className="mb-4 w-full">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
              Artwork / listing mockup
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={mockupHref}
              alt="Generated product artwork preview"
              className="mx-auto max-h-48 w-auto rounded-md border border-[var(--border-dim)] object-contain"
            />
          </div>
        ) : (
          <>
            <span className={pdfPreviewIcon} aria-hidden>
              ◧
            </span>
            <p className="text-sm font-medium text-[var(--foreground)]">
              {mockMode
                ? "Artwork placeholder — demo cycle has no generated assets"
                : generating
                  ? "Artwork & Printify draft generating..."
                  : generationStatus === "failed"
                    ? "Asset generation failed"
                    : "Artwork pending"}
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {mockMode
                ? "Approve only after you have verified copy and the POD blueprint."
                : generationStatus === "failed"
                  ? "Listing remains at Review Gate. Reject or run another cycle after fixes."
                  : "Artwork and the Printify product draft are created automatically after Forge. Approval unlocks once the draft is ready."}
            </p>
            {generating ? (
              <p className="mt-3 inline-flex items-center gap-2 text-xs text-[var(--text-muted)]">
                <Spinner />
                Generating...
              </p>
            ) : null}
          </>
        )}

        {legacyPdfHref ? (
          <a
            href={legacyPdfHref}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center justify-center rounded-md border border-[var(--accent-blue)]/50 bg-[var(--accent-blue)]/10 px-4 py-2 text-sm font-semibold text-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/20"
          >
            Download legacy PDF
          </a>
        ) : null}
      </div>
    </section>
  );
}

function Spinner() {
  return (
    <span
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
      aria-hidden
    />
  );
}
