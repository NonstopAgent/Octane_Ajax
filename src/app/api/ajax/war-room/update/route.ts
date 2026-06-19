/**
 * POST /api/ajax/war-room/update — operator sets a recommendation's status
 * (accepted | dismissed | actioned | proposed). Human-in-the-loop control.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { TABLES } from "@/lib/supabase/schema";

const ALLOWED = new Set(["proposed", "accepted", "dismissed", "actioned"]);

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      id?: string;
      status?: string;
    };
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const status = typeof body.status === "string" ? body.status.trim() : "";

    if (!id || !ALLOWED.has(status)) {
      return NextResponse.json(
        { ok: false, error: "Valid id and status are required." },
        { status: 400 },
      );
    }

    const { data, error } = await supabase
      .from(TABLES.STRATEGY)
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", user.id)
      .select("id, status")
      .single();

    if (error || !data) {
      return NextResponse.json(
        { ok: false, error: "Recommendation not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true, id: data.id, status: data.status });
  } catch (err) {
    console.error("[war-room/update] unexpected error", err);
    return NextResponse.json(
      { ok: false, error: "Failed to update recommendation." },
      { status: 500 },
    );
  }
}
