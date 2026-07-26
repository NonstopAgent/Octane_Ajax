export const maxDuration = 30;

import { NextResponse } from "next/server";
import { auditStore } from "@/lib/ajax/store-qa/audit";
import { fetchStoreListingsForQa } from "@/lib/ajax/store-qa/queries";
import { createClient } from "@/lib/supabase/server";
import { requireOperator } from "@/lib/auth/operator";

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

    // Operator-only (2026-07-25 audit, H10): signed-in is not authorized —
    // this surface mutates the ONE live shop on process-wide credentials.
    const operatorCheck = requireOperator(user);
    if (!operatorCheck.ok) {
      return NextResponse.json(
        { ok: false, error: operatorCheck.error },
        { status: operatorCheck.status },
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
