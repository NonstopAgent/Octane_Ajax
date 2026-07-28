/**
 * Shared cron-route preamble (2026-07-25 audit, M11).
 *
 * Every scheduled route needs the same two things before doing work:
 *   1. Prove the caller is Vercel Cron — Bearer CRON_SECRET, failing CLOSED
 *      when the secret is unset (H1).
 *   2. Resolve the operator account — cron has no session, so the service
 *      client resolves OPERATOR_EMAIL → user id (and is what the route then
 *      uses for DB work under RLS-exempt service role).
 *
 * This block used to be copy-pasted seven times and had already drifted
 * (three different not-found statuses and error strings). Single source now.
 * Never throws — any internal failure comes back as `{ ok: false, response }`.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export type CronOperatorResult =
  | {
      ok: true;
      /** Service-role client — cron routes act on the operator's rows with it. */
      supabase: ReturnType<typeof createServiceClient>;
      userId: string;
    }
  | { ok: false; response: NextResponse };

export async function resolveCronOperator(
  req: NextRequest,
): Promise<CronOperatorResult> {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      ),
    };
  }

  const operatorEmail = process.env.OPERATOR_EMAIL;
  if (!operatorEmail) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "OPERATOR_EMAIL env var not set." },
        { status: 500 },
      ),
    };
  }

  try {
    const supabase = createServiceClient();
    const { data: userList, error: listError } =
      await supabase.auth.admin.listUsers();
    if (listError) {
      return {
        ok: false,
        response: NextResponse.json(
          { ok: false, error: `Failed to list users: ${listError.message}` },
          { status: 500 },
        ),
      };
    }

    const operator = userList.users.find(
      (u) => u.email?.toLowerCase() === operatorEmail.toLowerCase(),
    );
    if (!operator) {
      return {
        ok: false,
        response: NextResponse.json(
          { ok: false, error: `No user found with email ${operatorEmail}.` },
          { status: 404 },
        ),
      };
    }

    return { ok: true, supabase, userId: operator.id };
  } catch (err) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          error: `Operator resolution failed: ${
            err instanceof Error ? err.message : "unknown error"
          }`,
        },
        { status: 500 },
      ),
    };
  }
}
