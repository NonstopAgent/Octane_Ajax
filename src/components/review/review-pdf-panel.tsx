import type { GenerationStatus } from "@/lib/supabase/schema";
import type { PdfAssetPlaceholders } from "@/lib/product/domain";
import {
  pdfPreviewIcon,
  pdfPreviewSlot,
  reviewQcPanel,
} from "@/components/review/review-panel-styles";
import { StatusBadge } from "@/components/ui/status-badge";

type ReviewPdfPanelProps = {
  pdf: PdfAssetPlaceholders;
  generationStatus: GenerationStatus;
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
  pdf,
  generationStatus,
  mockMode = false,
}: ReviewPdfPanelProps) {
  const hasUrl = Boolean(pdf.publicUrl?.trim());
  const hasPath = Boolean(pdf.storagePath?.trim());
  const downloadable = hasUrl && !mockMode;

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

      <div className={pdfPreviewSlot}>
        {downloadable ? (
          <>
            <span className={pdfPreviewIcon} aria-hidden>
              ⎙
            </span>
            <p className="text-sm font-medium text-[var(--foreground)]">
              PDF ready for inspection
            </p>
            <a
              href={pdf.publicUrl!}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center justify-center rounded-md border border-[var(--accent-blue)]/50 bg-[var(--accent-blue)]/10 px-4 py-2 text-sm font-semibold text-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/20"
            >
              Open PDF preview
            </a>
          </>
        ) : (
          <>
            <span className={pdfPreviewIcon} aria-hidden>
              ◧
            </span>
            <p className="text-sm font-medium text-[var(--foreground)]">
              {mockMode || generationStatus === "pending"
                ? "PDF placeholder — generation not run yet"
                : hasPath
                  ? "PDF stored — public URL pending"
                  : "PDF asset queued for Forge"}
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {mockMode
                ? "Demo cycle has no printable file. Approve only after you have verified copy and structure."
                : generationStatus === "failed"
                  ? "Regenerate from the factory floor after fixing structure or compliance issues."
                  : "Download will appear here when generation completes."}
            </p>
          </>
        )}
      </div>
    </section>
  );
}
