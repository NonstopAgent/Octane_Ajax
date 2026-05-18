import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
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
  const expectedState = cookieStore.get(ETSY_OAUTH_COOKIE_STATE)?.value;
  const codeVerifier = cookieStore.get(ETSY_OAUTH_COOKIE_VERIFIER)?.value;

  const clearCookies = (response: NextResponse) => {
    response.cookies.delete(ETSY_OAUTH_COOKIE_STATE);
    response.cookies.delete(ETSY_OAUTH_COOKIE_VERIFIER);
    return response;
  };

  if (!code || !state || !expectedState || !codeVerifier) {
    return clearCookies(
      settingsRedirect({
        etsy: "error",
        message: "Missing Etsy OAuth parameters.",
      }),
    );
  }

  if (state !== expectedState) {
    return clearCookies(
      settingsRedirect({
        etsy: "error",
        message: "Invalid OAuth state (CSRF check failed).",
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
