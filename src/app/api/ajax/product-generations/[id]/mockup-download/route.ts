import { NextResponse } from "next/server";
import { createProductPdfSignedUrl } from "@/lib/product/pdf-storage";
import { createClient } from "@/lib/supabase/server";
import { TABLES } from "@/lib/supabase/schema";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/** GET /api/ajax/product-generations/:id/mockup-download — signed URL redirect for owner */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id: generationId } = await context.params;
    if (!generationId) {
      return NextResponse.json(
        { ok: false, error: "Generation id is required." },
        { status: 400 },
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { data: row, error } = await supabase
      .from(TABLES.GENERATIONS)
      .select("id, user_id, mockup_storage_path")
      .eq("id", generationId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      console.error("[mockup-download] load generation", error);
      return NextResponse.json(
        { ok: false, error: "Failed to load generation." },
        { status: 500 },
      );
    }

    if (!row) {
      return NextResponse.json(
        { ok: false, error: "Generation not found." },
        { status: 404 },
      );
    }

    const stored = row.mockup_storage_path?.trim();
    if (!stored) {
      return NextResponse.json(
        { ok: false, error: "Mockup is not ready for download." },
        { status: 409 },
      );
    }

    // POD artwork is stored as a direct URL (Printify/OpenAI) — redirect.
    if (stored.startsWith("http://") || stored.startsWith("https://")) {
      return NextResponse.redirect(stored, { status: 302 });
    }

    // gpt-image-1 returns base64 — serve the bytes directly.
    if (stored.startsWith("data:")) {
      const match = /^data:(image\/[\w.+-]+);base64,([\s\S]*)$/.exec(stored);
      if (!match) {
        return NextResponse.json(
          { ok: false, error: "Stored artwork data is invalid." },
          { status: 500 },
        );
      }
      const bytes = Buffer.from(match[2]!, "base64");
      return new NextResponse(new Uint8Array(bytes), {
        status: 200,
        headers: {
          "Content-Type": match[1]!,
          "Cache-Control": "private, max-age=300",
        },
      });
    }

    // Legacy: Supabase Storage path from the retired PDF/mockup pipeline.
    const signedUrl = await createProductPdfSignedUrl(stored, 300);
    return NextResponse.redirect(signedUrl, { status: 302 });
  } catch (err) {
    console.error("[mockup-download]", err);
    return NextResponse.json(
      { ok: false, error: "Failed to create mockup download." },
      { status: 500 },
    );
  }
}
