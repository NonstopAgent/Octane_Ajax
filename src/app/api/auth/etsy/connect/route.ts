import { NextResponse } from "next/server";
import {
  createEtsyOAuthSession,
  EtsyAuthError,
  ETSY_OAUTH_COOKIE_STATE,
  ETSY_OAUTH_COOKIE_VERIFIER,
  saveEtsyOAuthSession,
} from "@/lib/ajax/etsy-auth";
import { createClient } from "@/lib/supabase/server";

const COOKIE_MAX_AGE = 1800;

/** GET /api/auth/etsy/connect — start Etsy OAuth (PKCE). */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.redirect(
        new URL("/login?next=/settings/etsy-connect", process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
      );
    }

    const session = createEtsyOAuthSession();
    // Persist the PKCE verifier server-side keyed by state — robust against
    // cookies being dropped across the Etsy/Google redirect chain. Cookies are
    // still set below as a fallback.
    await saveEtsyOAuthSession(user.id, session.state, session.codeVerifier);

    const response = NextResponse.redirect(session.authorizeUrl);

    const secure = process.env.NODE_ENV === "production";
    response.cookies.set(ETSY_OAUTH_COOKIE_STATE, session.state, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      maxAge: COOKIE_MAX_AGE,
      path: "/",
    });
    response.cookies.set(ETSY_OAUTH_COOKIE_VERIFIER, session.codeVerifier, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      maxAge: COOKIE_MAX_AGE,
      path: "/",
    });

    return response;
  } catch (err) {
    const message =
      err instanceof EtsyAuthError ? err.message : "Etsy connect failed.";
    console.error("[auth/etsy/connect]", err);
    const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    return NextResponse.redirect(
      new URL(`/settings?etsy=error&message=${encodeURIComponent(message)}`, base),
    );
  }
}
