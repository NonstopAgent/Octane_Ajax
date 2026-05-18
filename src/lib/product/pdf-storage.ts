/**
 * Server-only Supabase Storage helpers for product PDFs.
 */
import { createServiceClient } from "@/lib/supabase/server";

export const PRODUCT_PDFS_BUCKET = "product_pdfs";

const MAX_BYTES = 10 * 1024 * 1024;

/** User-scoped object path: `{userId}/{generationId}.pdf` */
export function buildProductPdfStoragePath(
  userId: string,
  generationId: string,
): string {
  return `${userId}/${generationId}.pdf`;
}

export function parseProductPdfStoragePath(path: string): {
  userId: string;
  generationId: string;
} | null {
  const match = /^([0-9a-f-]{36})\/([0-9a-f-]{36})\.pdf$/i.exec(path.trim());
  if (!match) return null;
  return { userId: match[1]!, generationId: match[2]! };
}

export async function uploadProductPdf(
  storagePath: string,
  pdfBytes: Buffer,
): Promise<void> {
  if (pdfBytes.byteLength === 0) {
    throw new Error("PDF buffer is empty.");
  }
  if (pdfBytes.byteLength > MAX_BYTES) {
    throw new Error(`PDF exceeds ${MAX_BYTES} byte limit.`);
  }

  const supabase = createServiceClient();
  const { error } = await supabase.storage
    .from(PRODUCT_PDFS_BUCKET)
    .upload(storagePath, pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (error) {
    throw new Error(`PDF upload failed: ${error.message}`);
  }
}

export async function createProductPdfSignedUrl(
  storagePath: string,
  expiresInSeconds = 300,
): Promise<string> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.storage
    .from(PRODUCT_PDFS_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);

  if (error || !data?.signedUrl) {
    throw new Error(
      `Signed URL failed: ${error?.message ?? "missing signedUrl"}`,
    );
  }

  return data.signedUrl;
}
