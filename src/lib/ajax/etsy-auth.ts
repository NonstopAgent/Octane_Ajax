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
// Resource endpoints live on openapi.etsy.com (api.etsy.com is only for the OAuth
// token endpoint above). Hitting api.etsy.com/v3/application returns a misleading
// 403 "Shared secret is required in x-api-key header".
const ETSY_API_BASE = "https://openapi.etsy.com/v3/application";

export const ETSY_OAUTH_SCOPES = [
  "listings_r",
  "listings_w",
  "shops_r",
  // Storefront maintenance (creating shop sections) — added 2026-07-13 for
  // the automated store organizer. Existing connections keep working; a
  // one-time reconnect picks this up and makes section creation autonomous.
  "shops_w",
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
  // Etsy v3 requires x-api-key = "keystring:shared_secret" (colon-separated).
  const secret = process.env.ETSY_CLIENT_SECRET?.trim();
  return {
    "x-api-key": secret ? `${clientId}:${secret}` : clientId,
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

// 5 minutes — NOT an hour. Etsy tokens live exactly 3600s, so a 60-minute
// buffer made the "still valid, reuse it" early-return unreachable: every one
// of the 17 call sites did a full OAuth refresh, and because Etsy ROTATES the
// refresh token on each exchange, two overlapping refreshers could exchange
// the same stored token and permanently desync us from Etsy (2026-07-25
// audit, H3). With 5 minutes a fresh token is reused for ~55 min.
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

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
 * Returns valid Etsy credentials, refreshing the access token when it expires
 * within REFRESH_BUFFER_MS. Updates `etsy_credentials` when refreshed.
 *
 * Concurrency-safe (2026-07-25 audit, H3): Etsy rotates the refresh token on
 * every exchange, so two concurrent refreshers exchanging the same stored
 * token used to leave the DB holding a dead token — every Etsy operation then
 * failed until a manual reconnect. Now (a) the UPDATE is conditional on the
 * refresh token we actually exchanged, and the loser adopts the winner's
 * stored pair instead of clobbering it; (b) an `invalid_grant` from the
 * exchange re-reads the row and, if another refresher already rotated it,
 * uses that instead of surfacing an error.
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

  let token: EtsyTokenResponse;
  try {
    token = await refreshEtsyAccessToken(row.refresh_token, options.fetchImpl);
  } catch (err) {
    // Likely a concurrent refresher already exchanged (and thereby burned)
    // the token we read. If the stored pair has rotated since, it's theirs —
    // use it. Only surface the failure when nothing changed.
    const latest = await loadEtsyCredentials(supabase, userId);
    if (latest && latest.refresh_token !== row.refresh_token) {
      return latest;
    }
    throw err;
  }
  const expiresAt = expiresAtFromTokenResponse(token);

  const { data: updated, error } = await supabase
    .from("etsy_credentials")
    .update({
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_at: expiresAt,
    })
    .eq("user_id", userId)
    .eq("refresh_token", row.refresh_token)
    .select("user_id");

  if (error) {
    throw new EtsyAuthError("Failed to update Etsy credentials.", undefined, error);
  }

  if ((updated?.length ?? 0) === 0) {
    // Lost the write race: another refresher rotated the stored pair while
    // our exchange was in flight. Adopt theirs — writing ours would desync
    // the DB from Etsy's latest rotation.
    const latest = await loadEtsyCredentials(supabase, userId);
    if (latest) return latest;
  }

  return {
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    shop_id: row.shop_id,
    expires_at: expiresAt,
  };
}
