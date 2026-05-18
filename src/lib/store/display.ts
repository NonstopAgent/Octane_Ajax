import type { GenerationStatus } from "@/lib/supabase/schema";
import type { PdfAssetPlaceholders } from "@/lib/product/domain";
import {
  buildProductPdfDownloadHref,
  getReviewPdfUiState,
} from "@/lib/review/display";

export function formatStorePrice(price: number | null | undefined): string {
  if (price == null || Number.isNaN(price)) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
  }).format(price);
}

export function pdfStatusLabel(status: GenerationStatus): string {
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

export function pdfStatusTone(
  status: GenerationStatus,
): "blue" | "orange" | "warning" | "neutral" {
  if (status === "ready") return "blue";
  if (status === "failed") return "orange";
  if (status === "generating" || status === "queued") return "warning";
  return "neutral";
}

export function getStorePdfDownloadHref(input: {
  generationId: string | null;
  generationStatus: GenerationStatus;
  pdf: PdfAssetPlaceholders;
  mockMode?: boolean;
}): string | null {
  const uiState = getReviewPdfUiState({
    generationStatus: input.generationStatus,
    storagePath: input.pdf.storagePath,
    mockMode: input.mockMode,
  });
  if (uiState !== "download" || !input.generationId) return null;
  return buildProductPdfDownloadHref(input.generationId);
}
