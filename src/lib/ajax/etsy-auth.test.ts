import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  buildEtsyAuthorizeUrl,
  exchangeAuthorizationCode,
  getEtsyAuthConfig,
  parseEtsyUserIdFromAccessToken,
  refreshEtsyAccessToken,
  refreshEtsyToken,
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

    const fetchImpl = async (_url: RequestInfo | URL, init?: RequestInit) => {
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

describe("refreshEtsyToken — race safety (H3)", () => {
  type CredRow = {
    user_id: string;
    access_token: string;
    refresh_token: string;
    shop_id: string;
    expires_at: string;
  };

  function makeSupabase(store: { row: CredRow }) {
    return {
      from(table: string) {
        if (table !== "etsy_credentials") throw new Error(`unexpected ${table}`);
        const filters: [string, unknown][] = [];
        let patch: Record<string, unknown> | null = null;
        const b = {
          select() {
            return b;
          },
          update(p: Record<string, unknown>) {
            patch = p;
            return b;
          },
          eq(col: string, val: unknown) {
            filters.push([col, val]);
            return b;
          },
          maybeSingle() {
            const match = filters.every(
              ([c, v]) => store.row[c as keyof CredRow] === v,
            );
            return Promise.resolve({
              data: match ? { ...store.row } : null,
              error: null,
            });
          },
          then(resolve: (v: { data: unknown[]; error: null }) => unknown) {
            const match = filters.every(
              ([c, v]) => store.row[c as keyof CredRow] === v,
            );
            if (match && patch) Object.assign(store.row, patch);
            return Promise.resolve({
              data: match ? [{ user_id: store.row.user_id }] : [],
              error: null,
            }).then(resolve);
          },
        };
        return b;
      },
    } as never;
  }

  function tokenResponse(prefix: string): Response {
    return new Response(
      JSON.stringify({
        access_token: `${prefix}-access`,
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: `${prefix}-refresh`,
      }),
      { status: 200 },
    );
  }

  it("reuses a still-valid token without calling Etsy at all", async () => {
    process.env.ETSY_CLIENT_ID = "test-client";
    const store = {
      row: {
        user_id: "u1",
        access_token: "live-access",
        refresh_token: "live-refresh",
        shop_id: "shop-1",
        // 50 minutes out — inside a 3600s lifetime, outside the 5-min buffer.
        expires_at: new Date(Date.now() + 50 * 60_000).toISOString(),
      },
    };
    let fetchCalls = 0;
    const fetchImpl = (async () => {
      fetchCalls += 1;
      return tokenResponse("never");
    }) as typeof fetch;

    const creds = await refreshEtsyToken("u1", {
      supabase: makeSupabase(store),
      fetchImpl,
    });

    assert.equal(creds?.access_token, "live-access");
    assert.equal(fetchCalls, 0);
  });

  it("refreshes an expiring token and persists the rotated pair", async () => {
    process.env.ETSY_CLIENT_ID = "test-client";
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
    const store = {
      row: {
        user_id: "u1",
        access_token: "old-access",
        refresh_token: "old-refresh",
        shop_id: "shop-1",
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    };
    const fetchImpl = (async () => tokenResponse("new")) as typeof fetch;

    const creds = await refreshEtsyToken("u1", {
      supabase: makeSupabase(store),
      fetchImpl,
    });

    assert.equal(creds?.access_token, "new-access");
    assert.equal(store.row.refresh_token, "new-refresh");
  });

  it("adopts the winner's pair when a concurrent refresher rotated first", async () => {
    process.env.ETSY_CLIENT_ID = "test-client";
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
    const store = {
      row: {
        user_id: "u1",
        access_token: "old-access",
        refresh_token: "old-refresh",
        shop_id: "shop-1",
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    };
    const supabase = makeSupabase(store);
    const fetchImpl = (async () => {
      // Simulate the OTHER refresher landing its rotation while our exchange
      // is in flight: the stored refresh token no longer matches ours.
      store.row.access_token = "winner-access";
      store.row.refresh_token = "winner-refresh";
      return tokenResponse("loser");
    }) as typeof fetch;

    const creds = await refreshEtsyToken("u1", { supabase, fetchImpl });

    // Conditional write must MISS (stored token ≠ the one we exchanged) and
    // the loser must come back holding the winner's live pair.
    assert.equal(store.row.refresh_token, "winner-refresh");
    assert.equal(creds?.access_token, "winner-access");
  });
});
