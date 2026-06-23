import { NextResponse } from "next/server";
import {
  createEtsyOAuthSession,
  EtsyAuthError,
  ETSY_OAUTH_COOKIE_STATE,
  ETSY_OAUTH_COOKIE_VERIFIER,
  etsyOAuthPkceCookieOptions,
} from "@/lib/ajax/etsy-auth";
import { createClient } from "@/lib/supabase/server";

/** GET /api/auth/etsy/connect — start Etsy OAuth (PKCE). */
export async function GET(request: Request) {
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
    const response = NextResponse.redirect(session.authorizeUrl);
    const cookieOptions = etsyOAuthPkceCookieOptions(request);

    response.cookies.set(ETSY_OAUTH_COOKIE_STATE, session.state, cookieOptions);
    response.cookies.set(
      ETSY_OAUTH_COOKIE_VERIFIER,
      session.codeVerifier,
      cookieOptions,
    );

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
