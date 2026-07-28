/**
 * Server-only Supabase Storage helpers for product assets.
 *
 * Naming note: the private `product_pdfs` bucket predates the POD pivot and
 * now stores mockup/preview images (signed-URL access); `product-artwork` is
 * the public bucket for generated artwork. The retired PDF upload/download
 * plumbing was deleted in the 2026-07 audit (M14).
 */
import { createServiceClient } from "@/lib/supabase/server";

export const PRODUCT_PDFS_BUCKET = "product_pdfs";
/** Public bucket for generated product artwork (served by stable public URL). */
export const PRODUCT_ARTWORK_BUCKET = "product-artwork";

const MAX_BYTES = 10 * 1024 * 1024;

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

/** Signed URL for an object in the private assets bucket (mockup previews). */
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
