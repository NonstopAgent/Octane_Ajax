import type { GenerationStatus } from "@/lib/supabase/schema";
import type { PdfAssetPlaceholders, ProductStructure } from "@/lib/product/domain";
import { isSellableStructure } from "@/lib/product/structure-to-document";
import {
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
  generationStatus: GenerationStatus;
  structure?: ProductStructure | null;
  mockMode?: boolean;
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
  generationStatus,
  structure,
  mockMode = false,
}: ReviewPdfPanelProps) {
  const uiState = getReviewPdfUiState({
    generationStatus,
    storagePath: pdf.storagePath,
    mockMode,
  });

  const downloadHref =
    generationId && uiState === "download"
      ? buildProductPdfDownloadHref(generationId)
      : null;

  const pageCount = structure?.pages.length ?? structure?.pageCount ?? 0;
  const format = structure?.format;
  const sellable = structure ? isSellableStructure(structure) : null;

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
              then run another cycle after fixes.
            </p>
          </>
        ) : (
          <>
            <span className={pdfPreviewIcon} aria-hidden>
              ◧
            </span>
            <p className="text-sm font-medium text-[var(--foreground)]">
              {mockMode
                ? "PDF placeholder — generation not run yet"
                : generationStatus === "generating" || generationStatus === "queued"
                  ? "PDF is generating…"
                  : "PDF asset pending"}
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {mockMode
                ? "Demo cycle has no printable file. Approve only after you have verified copy and structure."
                : "Download will appear here when generation completes."}
            </p>
          </>
        )}
      </div>

      <details className="mt-3 rounded-md border border-[var(--border-dim)] bg-black/20 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-[var(--text-muted)]">
          Sellability checklist (placeholder)
        </summary>
        <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-[var(--text-muted)]">
          <li>
            {sellable === null
              ? "Page count unknown until Forge structure loads"
              : sellable
                ? `${pageCount} pages — meets 6+ page guidance`
                : `${pageCount} pages — below 6-page sellable target`}
          </li>
          <li>Cover, instructions, worksheets, and summary present</li>
          <li>Tables, checklists, or fillable fields on worksheet pages</li>
          <li>Human review required before any future store publish</li>
        </ul>
      </details>
    </section>
  );
}
