import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  buildEtsyAuthorizeUrl,
  ETSY_OAUTH_COOKIE_MAX_AGE,
  exchangeAuthorizationCode,
  etsyOAuthPkceCookieOptions,
  getEtsyAuthConfig,
  parseEtsyUserIdFromAccessToken,
  refreshEtsyAccessToken,
} from "@/lib/ajax/etsy-auth";
import {
  codeChallengeFromVerifier,
  generateCodeVerifier,
} from "@/lib/ajax/etsy-pkce";

describe("etsy-auth", () => {
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  const originalClientId = process.env.ETSY_CLIENT_ID;

  afterEach(() => {
    if (originalAppUrl === undefined) {
      delete process.env.NEXT_PUBLIC_APP_URL;
    } else {
      process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
    }
    if (originalClientId === undefined) {
      delete process.env.ETSY_CLIENT_ID;
    } else {
      process.env.ETSY_CLIENT_ID = originalClientId;
    }
  });

  it("builds authorize URL with PKCE and Etsy connect endpoint", () => {
    process.env.ETSY_CLIENT_ID = "test-client";
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
    const verifier = generateCodeVerifier();
    const config = getEtsyAuthConfig();
    const url = new URL(
      buildEtsyAuthorizeUrl(config, "state-abc", verifier),
    );

    assert.equal(url.origin + url.pathname, "https://www.etsy.com/oauth/connect");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("client_id"), "test-client");
    assert.equal(
      url.searchParams.get("redirect_uri"),
      "https://app.example.com/api/auth/etsy/callback",
    );
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(
      url.searchParams.get("code_challenge"),
      codeChallengeFromVerifier(verifier),
    );
    assert.match(url.searchParams.get("scope") ?? "", /listings_w/);
  });

  it("parses Etsy user id prefix from access token", () => {
    assert.equal(parseEtsyUserIdFromAccessToken("12345.abc.def"), "12345");
  });

  it("exchanges authorization code at Etsy token endpoint", async () => {
    process.env.ETSY_CLIENT_ID = "test-client";
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";

    const calls: { url: string; body: string }[] = [];
    const fetchImpl = async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body ?? "") });
      return new Response(
        JSON.stringify({
          access_token: "99.new-token",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "99.refresh",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const token = await exchangeAuthorizationCode(
      "auth-code",
      "verifier-xyz",
      fetchImpl,
    );

    assert.equal(token.access_token, "99.new-token");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, "https://api.etsy.com/v3/public/oauth/token");
    assert.match(calls[0]!.body, /grant_type=authorization_code/);
    assert.match(calls[0]!.body, /code=auth-code/);
    assert.match(calls[0]!.body, /code_verifier=verifier-xyz/);
  });

  it("refreshes tokens with refresh_token grant", async () => {
    process.env.ETSY_CLIENT_ID = "test-client";
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";

    const fetchImpl = async (_url: string | URL, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      assert.match(body, /grant_type=refresh_token/);
      return new Response(
        JSON.stringify({
          access_token: "99.rotated",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "99.rotated-refresh",
        }),
        { status: 200 },
      );
    };

    const token = await refreshEtsyAccessToken("99.old-refresh", fetchImpl);
    assert.equal(token.access_token, "99.rotated");
  });

  it("uses lax sameSite and root path for PKCE cookies", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://octane-ajax.vercel.app";
    const request = new Request("https://octane-ajax.vercel.app/api/auth/etsy/connect");
    const options = etsyOAuthPkceCookieOptions(request);

    assert.equal(options.sameSite, "lax");
    assert.equal(options.path, "/");
    assert.equal(options.httpOnly, true);
    assert.equal(options.maxAge, ETSY_OAUTH_COOKIE_MAX_AGE);
    assert.equal(options.secure, true);
  });

  it("marks PKCE cookies secure for HTTPS production app URL", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://octane-ajax.vercel.app";
    const options = etsyOAuthPkceCookieOptions();

    assert.equal(options.secure, true);
    assert.equal(options.sameSite, "lax");
  });
});

describe("etsy-pkce", () => {
  it("produces stable S256 challenge for verifier", () => {
    const verifier = "vvkdljkejllufrvbhgeiegrnvufrhvrffnkvcknjvfid";
    assert.equal(
      codeChallengeFromVerifier(verifier),
      "DSWlW2Abh-cf8CeLL8-g3hQ2WQyYdKyiu83u_s7nRhI",
    );
  });
});
