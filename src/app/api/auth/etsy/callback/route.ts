import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  consumeEtsyOAuthSession,
  EtsyAuthError,
  ETSY_OAUTH_COOKIE_STATE,
  ETSY_OAUTH_COOKIE_VERIFIER,
  exchangeAuthorizationCode,
  fetchEtsyShopIdForUser,
  upsertEtsyCredentials,
} from "@/lib/ajax/etsy-auth";
import { createClient } from "@/lib/supabase/server";

function settingsRedirect(
  params: Record<string, string>,
): NextResponse {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "http://localhost:3000";
  const url = new URL("/settings", base);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url);
}

/** GET /api/auth/etsy/callback — OAuth code exchange + credential storage. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const oauthError = searchParams.get("error");
  if (oauthError) {
    const description = searchParams.get("error_description") ?? oauthError;
    return settingsRedirect({ etsy: "error", message: description });
  }

  const code = searchParams.get("code");
  const state = searchParams.get("state");

  const cookieStore = await cookies();
  const clearCookies = (response: NextResponse) => {
    response.cookies.delete(ETSY_OAUTH_COOKIE_STATE);
    response.cookies.delete(ETSY_OAUTH_COOKIE_VERIFIER);
    return response;
  };

  if (!code || !state) {
    const callbackUrl = `${process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? ""}/api/auth/etsy/callback`;
    return clearCookies(
      settingsRedirect({
        etsy: "error",
        message: `Etsy did not return an authorization code. Confirm your Etsy app's callback URL is exactly ${callbackUrl}, then try Connect again.`,
      }),
    );
  }

  // Recover the PKCE verifier: prefer the server-side session (cookie-independent),
  // then fall back to the connect-time cookies for backwards compatibility.
  const dbSession = await consumeEtsyOAuthSession(state);
  const cookieState = cookieStore.get(ETSY_OAUTH_COOKIE_STATE)?.value;
  const cookieVerifier = cookieStore.get(ETSY_OAUTH_COOKIE_VERIFIER)?.value;
  const codeVerifier =
    dbSession?.codeVerifier ??
    (cookieState && cookieState === state ? cookieVerifier : undefined);

  if (!codeVerifier) {
    return clearCookies(
      settingsRedirect({
        etsy: "error",
        message:
          "Etsy login session expired. Please click Connect Etsy shop and finish the Etsy sign-in within 30 minutes.",
      }),
    );
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return clearCookies(
        settingsRedirect({
          etsy: "error",
          message: "Sign in required to connect Etsy.",
        }),
      );
    }

    if (dbSession && dbSession.userId !== user.id) {
      return clearCookies(
        settingsRedirect({
          etsy: "error",
          message:
            "OAuth session did not match the signed-in user. Please try Connect again.",
        }),
      );
    }

    const token = await exchangeAuthorizationCode(code, codeVerifier);
    const shopId = await fetchEtsyShopIdForUser(token.access_token);
    await upsertEtsyCredentials(supabase, user.id, token, shopId);

    return clearCookies(settingsRedirect({ etsy: "connected" }));
  } catch (err) {
    const message =
      err instanceof EtsyAuthError ? err.message : "Etsy authorization failed.";
    console.error("[auth/etsy/callback]", err);
    return clearCookies(
      settingsRedirect({ etsy: "error", message }),
    );
  }
}
