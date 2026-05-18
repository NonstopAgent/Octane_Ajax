"use client";

import { useCallback, useState } from "react";
import type { GenerationStatus } from "@/lib/supabase/schema";
import type { PdfAssetPlaceholders, ProductStructure } from "@/lib/product/domain";
import {
  buildProductPdfDownloadHref,
  buildProductPdfGenerateHref,
  getReviewPdfUiState,
} from "@/lib/review/display";
import {
  pdfPreviewIcon,
  pdfPreviewSlot,
  reviewQcPanel,
} from "@/components/review/review-panel-styles";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";

type ReviewPdfPanelProps = {
  generationId: string | null;
  pdf: PdfAssetPlaceholders;
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
      return "PDF ready";
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

export function ReviewPdfPanel({
  generationId,
  pdf,
  generationStatus: initialStatus,
  structure,
  mockMode = false,
  onGenerationChange,
}: ReviewPdfPanelProps) {
  const [generationStatus, setGenerationStatus] =
    useState<GenerationStatus>(initialStatus);
  const [storagePath, setStoragePath] = useState(pdf.storagePath);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const applyGenerationPatch = useCallback(
    (patch: {
      generationStatus: GenerationStatus;
      storagePath?: string | null;
    }) => {
      setGenerationStatus(patch.generationStatus);
      if (patch.storagePath !== undefined) {
        setStoragePath(patch.storagePath);
      }
      onGenerationChange?.(patch);
    },
    [onGenerationChange],
  );

  const generatePdf = async () => {
    if (!generationId || mockMode) return;

    setBusy(true);
    setActionError(null);
    applyGenerationPatch({ generationStatus: "generating" });

    try {
      const res = await fetch(buildProductPdfGenerateHref(generationId), {
        method: "POST",
        credentials: "include",
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        status?: GenerationStatus;
        storagePath?: string;
      };

      if (!res.ok) {
        const nextStatus =
          data.status === "generating" ? "generating" : "failed";
        applyGenerationPatch({ generationStatus: nextStatus });
        setActionError(
          data.error ??
            "PDF generation failed. Request failed or timed out. Check Vercel logs.",
        );
        return;
      }

      applyGenerationPatch({
        generationStatus: data.status ?? "ready",
        storagePath: data.storagePath ?? storagePath,
      });
    } catch {
      applyGenerationPatch({ generationStatus: "failed" });
      setActionError(
        "Request failed or timed out. Check Vercel logs.",
      );
    } finally {
      setBusy(false);
    }
  };

  const uiState = getReviewPdfUiState({
    generationStatus,
    storagePath,
    mockMode,
  });

  const downloadHref =
    generationId && uiState === "download"
      ? buildProductPdfDownloadHref(generationId)
      : null;

  const pageCount = structure?.pages.length ?? structure?.pageCount ?? 0;
  const format = structure?.format;

  const showGenerate =
    !mockMode &&
    generationId &&
    (generationStatus === "pending" ||
      generationStatus === "queued" ||
      generationStatus === "failed");
  const showGenerating =
    !mockMode && generationId && generationStatus === "generating";

  return (
    <section
      className={reviewQcPanel}
      aria-labelledby="review-pdf-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          id="review-pdf-heading"
          className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--accent-blue)]"
        >
          Printable asset
        </p>
        <StatusBadge
          label={statusLabel(generationStatus)}
          tone={statusTone(generationStatus)}
        />
      </div>

      {structure && pageCount > 0 ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
          <div>
            <dt className="font-mono uppercase tracking-wider">Pages</dt>
            <dd className="text-[var(--foreground)]">{pageCount}</dd>
          </div>
          {format ? (
            <div>
              <dt className="font-mono uppercase tracking-wider">Format</dt>
              <dd className="text-[var(--foreground)]">{format}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <div className={pdfPreviewSlot}>
        {downloadHref ? (
          <>
            <span className={pdfPreviewIcon} aria-hidden>
              ⎙
            </span>
            <p className="text-sm font-medium text-[var(--foreground)]">
              PDF ready for inspection
            </p>
            <a
              href={downloadHref}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center justify-center rounded-md border border-[var(--accent-blue)]/50 bg-[var(--accent-blue)]/10 px-4 py-2 text-sm font-semibold text-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/20"
            >
              Download PDF
            </a>
          </>
        ) : uiState === "failed" ? (
          <>
            <span className={pdfPreviewIcon} aria-hidden>
              ⚠
            </span>
            <p className="text-sm font-medium text-[var(--foreground)]">
              PDF generation failed
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Listing remains at Review Gate. Inspect structure and compliance,
              then retry PDF generation or run another cycle after fixes.
            </p>
            {showGenerate ? (
              <Button
                type="button"
                variant="secondary"
                className="mt-3 h-10"
                disabled={busy}
                onClick={() => void generatePdf()}
              >
                {busy ? "Generating…" : "Retry PDF generation"}
              </Button>
            ) : null}
          </>
        ) : (
          <>
            <span className={pdfPreviewIcon} aria-hidden>
              ◧
            </span>
            <p className="text-sm font-medium text-[var(--foreground)]">
              {mockMode
                ? "PDF placeholder — generation not run yet"
                : showGenerating
                  ? "PDF is generating…"
                  : "PDF asset pending"}
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {mockMode
                ? "Demo cycle has no printable file. Approve only after you have verified copy and structure."
                : "Generate the printable PDF before download — approval does not require a ready file."}
            </p>
            {showGenerate && !showGenerating ? (
              <Button
                type="button"
                variant="primary"
                className="mt-3 h-10"
                disabled={busy}
                onClick={() => void generatePdf()}
              >
                {busy ? "Generating…" : "Generate PDF"}
              </Button>
            ) : null}
            {showGenerating ? (
              <p className="mt-3 inline-flex items-center gap-2 text-xs text-[var(--text-muted)]">
                <Spinner />
                Building printable asset…
              </p>
            ) : null}
          </>
        )}
        {actionError ? (
          <p className="mt-3 text-xs text-red-300" role="alert">
            {actionError}
          </p>
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