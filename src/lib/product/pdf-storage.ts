/**
 * Server-only Supabase Storage helpers for product PDFs.
 */
import { createServiceClient } from "@/lib/supabase/server";

export const PRODUCT_PDFS_BUCKET = "product_pdfs";
/** Public bucket for generated product artwork (served by stable public URL). */
export const PRODUCT_ARTWORK_BUCKET = "product-artwork";

const MAX_BYTES = 10 * 1024 * 1024;

/** User-scoped object path: `{userId}/{generationId}.pdf` */
export function buildProductPdfStoragePath(
  userId: string,
  generationId: string,
): string {
  return `${userId}/${generationId}.pdf`;
}

/** User-scoped mockup path: `{userId}/{generationId}_mockup.jpg` */
export function buildProductMockupStoragePath(
  userId: string,
  generationId: string,
): string {
  return `${userId}/${generationId}_mockup.jpg`;
}

export async function uploadProductMockup(
  storagePath: string,
  imageBytes: Buffer,
): Promise<void> {
  if (imageBytes.byteLength === 0) {
    throw new Error("Mockup image buffer is empty.");
  }
  if (imageBytes.byteLength > MAX_BYTES) {
    throw new Error(`Mockup image exceeds ${MAX_BYTES} byte limit.`);
  }

  const supabase = createServiceClient();
  const { error } = await supabase.storage
    .from(PRODUCT_PDFS_BUCKET)
    .upload(storagePath, imageBytes, {
      contentType: "image/jpeg",
      upsert: true,
    });

  if (error) {
    throw new Error(`Mockup upload failed: ${error.message}`);
  }
}

/** User-scoped artwork path: `{userId}/{generationId}_artwork.png` */
export function buildProductArtworkStoragePath(
  userId: string,
  generationId: string,
): string {
  return `${userId}/${generationId}_artwork.png`;
}

/** Upload generated product artwork (decoded image bytes) to Storage. */
export async function uploadProductArtwork(
  storagePath: string,
  imageBytes: Buffer,
  contentType = "image/png",
): Promise<void> {
  if (imageBytes.byteLength === 0) {
    throw new Error("Artwork image buffer is empty.");
  }
  if (imageBytes.byteLength > MAX_BYTES) {
    throw new Error(`Artwork image exceeds ${MAX_BYTES} byte limit.`);
  }

  const supabase = createServiceClient();
  const { error } = await supabase.storage
    .from(PRODUCT_PDFS_BUCKET)
    .upload(storagePath, imageBytes, {
      contentType,
      upsert: true,
    });

  if (error) {
    throw new Error(`Artwork upload failed: ${error.message}`);
  }
}

/**
 * Uploads generated artwork to the PUBLIC artwork bucket and returns a stable
 * public URL (usable by the Review UI, the store, and Printify alike). This
 * avoids storing multi-MB base64 data URIs in the database.
 */
export async function uploadPublicArtwork(
  userId: string,
  generationId: string,
  imageBytes: Buffer,
  contentType = "image/png",
): Promise<string> {
  if (imageBytes.byteLength === 0) {
    throw new Error("Artwork image buffer is empty.");
  }
  if (imageBytes.byteLength > MAX_BYTES) {
    throw new Error(`Artwork image exceeds ${MAX_BYTES} byte limit.`);
  }

  const ext = contentType.includes("jpeg")
    ? "jpg"
    : contentType.includes("webp")
      ? "webp"
      : "png";
  const objectPath = `${userId}/${generationId}.${ext}`;

  const supabase = createServiceClient();
  const { error } = await supabase.storage
    .from(PRODUCT_ARTWORK_BUCKET)
    .upload(objectPath, imageBytes, { contentType, upsert: true });

  if (error) {
    throw new Error(`Artwork upload failed: ${error.message}`);
  }

  const { data } = supabase.storage
    .from(PRODUCT_ARTWORK_BUCKET)
    .getPublicUrl(objectPath);
  return data.publicUrl;
}

export async function downloadProductMockup(mockupRef: string): Promise<Buffer> {
  // Artwork is now stored as a public URL (product-artwork bucket) — fetch it.
  if (mockupRef.startsWith("http://") || mockupRef.startsWith("https://")) {
    const res = await fetch(mockupRef, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      throw new Error(`Mockup fetch failed (${res.status}): ${mockupRef}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  // Legacy gpt-image-1 data: URI fallback.
  if (mockupRef.startsWith("data:")) {
    const match = /^data:[\w.+/-]+;base64,([\s\S]+)$/.exec(mockupRef);
    if (!match) {
      throw new Error("Mockup data URI is invalid.");
    }
    return Buffer.from(match[1]!, "base64");
  }

  // Legacy storage object path — read from the artwork bucket.
  const supabase = createServiceClient();
  const { data, error } = await supabase.storage
    .from(PRODUCT_ARTWORK_BUCKET)
    .download(mockupRef);

  if (error || !data) {
    throw new Error(
      `Mockup download failed: ${error?.message ?? "missing file data"}`,
    );
  }

  return Buffer.from(await data.arrayBuffer());
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

export async function downloadProductPdf(storagePath: string): Promise<Buffer> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.storage
    .from(PRODUCT_PDFS_BUCKET)
    .download(storagePath);

  if (error || !data) {
    throw new Error(
      `PDF download failed: ${error?.message ?? "missing file data"}`,
    );
  }

  return Buffer.from(await data.arrayBuffer());
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
