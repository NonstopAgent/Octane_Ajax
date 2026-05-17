import { NextResponse } from "next/server";
import {
  buildAllAgentMemories,
  fetchAgentFeedback,
} from "@/lib/ajax/agent-memory";
import { createClient } from "@/lib/supabase/server";

/** GET /api/ajax/agent-memory — profiles for Nova, Forge, Pixel. */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const feedback = await fetchAgentFeedback(supabase, user.id);
    const agents = buildAllAgentMemories(feedback);

    return NextResponse.json({ ok: true, agents });
  } catch (err) {
    console.error("[agent-memory]", err);
    return NextResponse.json(
      { ok: false, error: "Failed to load agent memory." },
      { status: 500 },
    );
  }
}
