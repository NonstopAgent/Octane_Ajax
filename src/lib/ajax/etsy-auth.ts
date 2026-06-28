/**
 * Etsy OAuth 2.0 + credential storage — server-side only.
 */

import {
  codeChallengeFromVerifier,
  generateCodeVerifier,
  generateOAuthState,
} from "@/lib/ajax/etsy-pkce";
import type { Supabase } from "@/lib/supabase/helpers";
import { createServiceClient } from "@/lib/supabase/server";

const ETSY_AUTHORIZE_URL = "https://www.etsy.com/oauth/connect";
const ETSY_TOKEN_URL = "https://api.etsy.com/v3/public/oauth/token";
const ETSY_API_BASE = "https://api.etsy.com/v3/application";

export const ETSY_OAUTH_SCOPES = [
  "listings_r",
  "listings_w",
  "shops_r",
  "email_r",
] as const;

/**
 * Scopes requested at authorize time. `transactions_r` (sales/receipts for the
 * revenue analytics poller) is OPT-IN: an Etsy app must list that scope before
 * Etsy will honor it, and requesting an unlisted scope makes Etsy reject the
 * resulting token's API calls (403). Enable it with
 * ETSY_ENABLE_TRANSACTIONS_SCOPE=true once your Etsy app includes transactions_r.
 * Without it the connection still works — drafts + views/favorites analytics
 * function, only revenue/orders are skipped.
 */
export function getEtsyOAuthScopes(): string[] {
  const scopes: string[] = [...ETSY_OAUTH_SCOPES];
  if (process.env.ETSY_ENABLE_TRANSACTIONS_SCOPE?.trim() === "true") {
    scopes.push("transactions_r");
  }
  return scopes;
}

export const ETSY_OAUTH_COOKIE_STATE = "etsy_oauth_state";
export const ETSY_OAUTH_COOKIE_VERIFIER = "etsy_oauth_verifier";

export type EtsyTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
};

export type EtsyCredentialsRow = {
  access_token: string;
  refresh_token: string;
  shop_id: string;
  expires_at: string;
};

export class EtsyAuthError extends Error {
  readonly code = "ETSY_AUTH_ERROR" as const;

  constructor(
    message: string,
    readonly statusCode?: number,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "EtsyAuthError";
  }
}

export type EtsyAuthConfig = {
  clientId: string;
  redirectUri: string;
};

export function getEtsyAuthConfig(): EtsyAuthConfig {
  const clientId = process.env.ETSY_CLIENT_ID?.trim();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");

  if (!clientId) {
    throw new EtsyAuthError("ETSY_CLIENT_ID is not configured.");
  }
  if (!appUrl) {
    throw new EtsyAuthError("NEXT_PUBLIC_APP_URL is not configured.");
  }

  return {
    clientId,
    redirectUri: `${appUrl}/api/auth/etsy/callback`,
  };
}

export function buildEtsyAuthorizeUrl(
  config: EtsyAuthConfig,
  state: string,
  codeVerifier: string,
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: getEtsyOAuthScopes().join(" "),
    state,
    code_challenge: codeChallengeFromVerifier(codeVerifier),
    code_challenge_method: "S256",
  });
  return `${ETSY_AUTHORIZE_URL}?${params.toString()}`;
}

export function createEtsyOAuthSession(): {
  state: string;
  codeVerifier: string;
  authorizeUrl: string;
} {
  const config = getEtsyAuthConfig();
  const state = generateOAuthState();
  const codeVerifier = generateCodeVerifier();
  return {
    state,
    codeVerifier,
    authorizeUrl: buildEtsyAuthorizeUrl(config, state, codeVerifier),
  };
}

export function parseEtsyUserIdFromAccessToken(accessToken: string): string {
  const userId = accessToken.split(".")[0]?.trim();
  if (!userId) {
    throw new EtsyAuthError("Etsy access token missing user id prefix.");
  }
  return userId;
}

async function postTokenRequest(
  body: URLSearchParams,
  fetchImpl: typeof fetch = fetch,
): Promise<EtsyTokenResponse> {
  const config = getEtsyAuthConfig();
  body.set("client_id", config.clientId);

  const response = await fetchImpl(ETSY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const text = await response.text();
  let parsed: EtsyTokenResponse & { error?: string; error_description?: string } =
    {} as EtsyTokenResponse;
  if (text) {
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      throw new EtsyAuthError(
        `Etsy token endpoint returned non-JSON (${response.status}).`,
        response.status,
      );
    }
  }

  if (!response.ok || !parsed.access_token) {
    throw new EtsyAuthError(
      parsed.error_description ??
        parsed.error ??
        `Etsy token request failed (${response.status}).`,
      response.status,
    );
  }

  return parsed;
}

export async function exchangeAuthorizationCode(
  code: string,
  codeVerifier: string,
  fetchImpl?: typeof fetch,
): Promise<EtsyTokenResponse> {
  const config = getEtsyAuthConfig();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
    code_verifier: codeVerifier,
  });
  return postTokenRequest(body, fetchImpl);
}

export async function refreshEtsyAccessToken(
  refreshToken: string,
  fetchImpl?: typeof fetch,
): Promise<EtsyTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  return postTokenRequest(body, fetchImpl);
}

function etsyApiHeaders(accessToken: string, clientId: string): HeadersInit {
  return {
    "x-api-key": clientId,
    Authorization: `Bearer ${accessToken}`,
  };
}

export async function fetchEtsyShopIdForUser(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const { clientId } = getEtsyAuthConfig();
  const etsyUserId = parseEtsyUserIdFromAccessToken(accessToken);
  const response = await fetchImpl(
    `${ETSY_API_BASE}/users/${etsyUserId}/shops`,
    { headers: etsyApiHeaders(accessToken, clientId) },
  );

  const text = await response.text();
  let body: { shop_id?: number; results?: { shop_id?: number }[] } = {};
  if (text) {
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      throw new EtsyAuthError(
        `Etsy shop lookup returned non-JSON (${response.status}).`,
        response.status,
      );
    }
  }

  if (!response.ok) {
    const detail =
      (body as { error_description?: string; error?: string }).error_description ??
      (body as { error?: string }).error ??
      (text ? text.slice(0, 200) : "");
    throw new EtsyAuthError(
      `Failed to load Etsy shop (${response.status})${detail ? `: ${detail}` : ""}.`,
      response.status,
    );
  }

  const shopId =
    body.shop_id != null
      ? String(body.shop_id)
      : body.results?.[0]?.shop_id != null
        ? String(body.results[0].shop_id)
        : null;

  if (!shopId) {
    throw new EtsyAuthError(
      "No Etsy shop found for this account. Open a shop on Etsy first.",
      404,
    );
  }

  return shopId;
}

export function expiresAtFromTokenResponse(token: EtsyTokenResponse): string {
  const seconds = token.expires_in > 0 ? token.expires_in : 3600;
  return new Date(Date.now() + seconds * 1000).toISOString();
}

export async function upsertEtsyCredentials(
  supabase: Supabase,
  userId: string,
  token: EtsyTokenResponse,
  shopId: string,
) {
  const expiresAt = expiresAtFromTokenResponse(token);
  const { error } = await supabase.from("etsy_credentials").upsert(
    {
      user_id: userId,
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      shop_id: shopId,
      expires_at: expiresAt,
    },
    { onConflict: "user_id" },
  );

  if (error) {
    throw new EtsyAuthError("Failed to save Etsy credentials.", undefined, error);
  }
}

/**
 * Persists a PKCE session (state -> code_verifier) server-side so the OAuth
 * callback can recover the verifier without depending on cookies (which browsers
 * often drop across the Etsy -> Google -> Etsy sign-in redirect chain).
 */
export async function saveEtsyOAuthSession(
  userId: string,
  state: string,
  codeVerifier: string,
): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.from("etsy_oauth_sessions").insert({
    state,
    user_id: userId,
    code_verifier: codeVerifier,
  });
  if (error) {
    throw new EtsyAuthError(
      "Failed to save Etsy OAuth session.",
      undefined,
      error,
    );
  }
}

/**
 * Looks up and deletes (one-time use) a PKCE session by `state`. Returns null if
 * absent or older than 30 minutes.
 */
export async function consumeEtsyOAuthSession(
  state: string,
): Promise<{ userId: string; codeVerifier: string } | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("etsy_oauth_sessions")
    .select("user_id, code_verifier, created_at")
    .eq("state", state)
    .maybeSingle();
  if (!data) return null;

  await supabase.from("etsy_oauth_sessions").delete().eq("state", state);

  const ageMs = Date.now() - new Date(data.created_at).getTime();
  if (ageMs > 30 * 60 * 1000) return null;
  return { userId: data.user_id, codeVerifier: data.code_verifier };
}

const REFRESH_BUFFER_MS = 60 * 60 * 1000;

export async function loadEtsyCredentials(
  supabase: Supabase,
  userId: string,
): Promise<EtsyCredentialsRow | null> {
  const { data, error } = await supabase
    .from("etsy_credentials")
    .select("access_token, refresh_token, shop_id, expires_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new EtsyAuthError("Failed to load Etsy credentials.", undefined, error);
  }

  return data;
}

/**
 * Returns valid Etsy credentials, refreshing the access token when expiring
 * within one hour. Updates `etsy_credentials` when refreshed.
 */
export async function refreshEtsyToken(
  userId: string,
  options: {
    supabase?: Supabase;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<EtsyCredentialsRow | null> {
  const supabase = options.supabase ?? createServiceClient();
  const row = await loadEtsyCredentials(supabase, userId);
  if (!row) return null;

  const expiresAtMs = new Date(row.expires_at).getTime();
  if (expiresAtMs - Date.now() > REFRESH_BUFFER_MS) {
    return row;
  }

  const token = await refreshEtsyAccessToken(row.refresh_token, options.fetchImpl);
  const expiresAt = expiresAtFromTokenResponse(token);

  const { error } = await supabase
    .from("etsy_credentials")
    .update({
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_at: expiresAt,
    })
    .eq("user_id", userId);

  if (error) {
    throw new EtsyAuthError("Failed to update Etsy credentials.", undefined, error);
  }

  return {
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    shop_id: row.shop_id,
    expires_at: expiresAt,
  };
}
