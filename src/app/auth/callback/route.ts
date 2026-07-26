import { NextResponse } from "next/server";
import { safeNextPath } from "@/lib/auth/routes";
import { createClient } from "@/lib/supabase/server";

/** OAuth / magic-link callback — refreshes session cookies after redirect. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // NEVER interpolate a raw `next` onto the origin (2026-07-25 audit, M5):
  // `?next=@evil.com` made `${origin}@evil.com`, whose host is evil.com — an
  // off-site landing immediately after a real, successful sign-in.
  const next = safeNextPath(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  return NextResponse.redirect(new URL("/login?error=auth_callback", origin));
}
