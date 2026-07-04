export const maxDuration = 30;

import { NextResponse } from "next/server";
import { auditStore } from "@/lib/ajax/store-qa/audit";
import { fetchStoreListingsForQa } from "@/lib/ajax/store-qa/queries";
import { createClient } from "@/lib/supabase/server";

/** GET /api/ajax/store/qa — whole-shop professionalism sweep + prioritized fixes. */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      );
    }
    const listings = await fetchStoreListingsForQa(supabase, user.id);
    const report = auditStore(listings);
    return NextResponse.json({ ok: true, report });
  } catch (err) {
    console.error("[store/qa] error", err);
    return NextResponse.json(
      { ok: false, error: "Store QA failed." },
      { status: 500 },
    );
  }
}
