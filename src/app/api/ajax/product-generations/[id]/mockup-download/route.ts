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

    if (!row.mockup_storage_path?.trim()) {
      return NextResponse.json(
        { ok: false, error: "Mockup is not ready for download." },
        { status: 409 },
      );
    }

    const signedUrl = await createProductPdfSignedUrl(row.mockup_storage_path, 300);
    return NextResponse.redirect(signedUrl, { status: 302 });
  } catch (err) {
    console.error("[mockup-download]", err);
    return NextResponse.json(
      { ok: false, error: "Failed to create mockup download." },
      { status: 500 },
    );
  }
}
