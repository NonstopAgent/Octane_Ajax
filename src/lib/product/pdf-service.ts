/**
 * Server-only: generate printable PDFs and persist to Supabase Storage.
 */
import { generateProductPdfBuffer } from "@/lib/product/pdf-generator";
import {
  buildProductPdfStoragePath,
  uploadProductPdf,
} from "@/lib/product/pdf-storage";
import { productStructureToDocument } from "@/lib/product/structure-to-document";
import type { ProductStructure } from "@/lib/product/domain";
import { mapGenerationToDbUpdate } from "@/lib/product/mappers";
import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";

export type GenerateProductPdfInput = {
  supabase: Supabase;
  userId: string;
  generationId: string;
  structure: ProductStructure;
  listingTitle: string;
  listingDescription?: string;
  footerNote?: string;
  audience?: string;
};

export type GenerateProductPdfResult =
  | {
      ok: true;
      storagePath: string;
    }
  | {
      ok: false;
      error: string;
    };

async function setGenerationStatus(
  supabase: Supabase,
  generationId: string,
  userId: string,
  patch: ReturnType<typeof mapGenerationToDbUpdate>,
): Promise<void> {
  const { error } = await supabase
    .from(TABLES.GENERATIONS)
    .update(patch)
    .eq("id", generationId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to update product_generations: ${error.message}`);
  }
}

/**
 * Generate a PDF from structure, upload to storage, and mark generation ready.
 * On failure, sets `generation_status` to `failed` and appends a compliance warning.
 */
export async function generateAndStoreProductPdf(
  input: GenerateProductPdfInput,
): Promise<GenerateProductPdfResult> {
  const {
    supabase,
    userId,
    generationId,
    structure,
    listingTitle,
    listingDescription,
    footerNote,
    audience,
  } = input;

  try {
    await setGenerationStatus(
      supabase,
      generationId,
      userId,
      mapGenerationToDbUpdate({ generationStatus: "generating" }),
    );

    const document = productStructureToDocument(structure, {
      title: listingTitle,
      subtitle: listingDescription,
      audience,
      footerNote,
    });

    const pdfBuffer = await generateProductPdfBuffer(document);
    const storagePath = buildProductPdfStoragePath(userId, generationId);

    await uploadProductPdf(storagePath, pdfBuffer);

    await setGenerationStatus(
      supabase,
      generationId,
      userId,
      mapGenerationToDbUpdate({
        generationStatus: "ready",
        pdf: { storagePath, publicUrl: null },
      }),
    );

    return { ok: true, storagePath };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "PDF generation failed.";

    const { data: row } = await supabase
      .from(TABLES.GENERATIONS)
      .select("compliance_warnings")
      .eq("id", generationId)
      .eq("user_id", userId)
      .maybeSingle();

    const priorWarnings = row?.compliance_warnings ?? [];
    const pdfWarning = `PDF generation failed: ${message}`;

    await setGenerationStatus(
      supabase,
      generationId,
      userId,
      mapGenerationToDbUpdate({
        generationStatus: "failed",
        complianceWarnings: [...priorWarnings, pdfWarning],
      }),
    ).catch(() => {
      /* best-effort status write */
    });

    return { ok: false, error: message };
  }
}
