/**
 * GET /api/cron/run-nova
 *
 * Called daily by Vercel Cron (configured in vercel.json).
 * Runs Nova + Forge for the operator account automatically — products appear
 * in the Review Gate each morning without manual triggering.
 *
 * Security: Vercel sends CRON_SECRET as Bearer token. Route returns 401 if missing.
 */
export const maxDuration = 300;

import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { runNovaStep, runForgeStep, CycleBlockedError, SimulatorError } from "@/lib/ajax/simulator";
import { runGenerationPodJob } from "@/lib/product/generation-pod-runner";

export async function GET(req: NextRequest) {
  // Validate Vercel cron secret
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const operatorEmail = process.env.OPERATOR_EMAIL;
  if (!operatorEmail) {
    return NextResponse.json(
      { ok: false, error: "OPERATOR_EMAIL env var not set. Add your login email to Vercel env vars." },
      { status: 500 },
    );
  }

  try {
    // Cron has no user session — use the service-role client (required for
    // auth.admin.listUsers and for acting on the operator's rows under RLS).
    const supabase = createServiceClient();

    // Resolve the operator's user ID from their email
    const { data: userList, error: listError } = await supabase.auth.admin.listUsers();
    if (listError) {
      return NextResponse.json(
        { ok: false, error: `Failed to list users: ${listError.message}` },
        { status: 500 },
      );
    }

    const operator = userList.users.find(
      (u) => u.email?.toLowerCase() === operatorEmail.toLowerCase(),
    );

    if (!operator) {
      return NextResponse.json(
        { ok: false, error: `No user found with email ${operatorEmail}. Sign up first.` },
        { status: 404 },
      );
    }

    const userId = operator.id;

    // Run Nova
    const novaSummary = await runNovaStep(supabase, userId);

    // Auto-chain Forge
    const forgeSummary = await runForgeStep(supabase, userId, { runId: novaSummary.runId });

    // Automated cycles have no browser to drive the Review Gate poller, so run
    // POD fulfillment inline here (own 300s budget). Non-fatal: on failure the
    // listing stays at the Review Gate as 'failed' and can be retried.
    try {
      await runGenerationPodJob(supabase, userId, forgeSummary.generationId);
    } catch (fulfillErr) {
      console.error("[cron/run-nova] fulfillment failed", fulfillErr);
    }

    return NextResponse.json({
      ok: true,
      runId: novaSummary.runId,
      ideasGenerated: novaSummary.ideas.length,
      listingCreated: forgeSummary.listing.title,
      message: "Daily Nova cycle complete. Listing queued at Review Gate.",
    });
  } catch (err) {
    if (err instanceof CycleBlockedError) {
      // A listing is already pending review — skip today's cycle
      return NextResponse.json(
        { ok: false, code: "CYCLE_BLOCKED", error: err.message, skipped: true },
        { status: 200 }, // 200 so Vercel doesn't retry
      );
    }

    if (err instanceof SimulatorError) {
      console.error("[cron/run-nova]", err.message, err.cause);
      return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }

    console.error("[cron/run-nova] unexpected error", err);
    return NextResponse.json(
      { ok: false, error: "Unexpected error during cron cycle." },
      { status: 500 },
    );
  }
}
