import Link from "next/link";
import { Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { ButtonLink } from "@/components/ui/button";
import { isSupabaseConfigured } from "@/lib/auth/env";
import { createClient } from "@/lib/supabase/server";

export default async function EtsyConnectPage() {
  const configured = isSupabaseConfigured();
  let signedIn = false;
  let connected = false;
  let shopId: string | null = null;

  if (configured) {
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      signedIn = Boolean(user);
      if (user) {
        const { data } = await supabase
          .from("etsy_credentials")
          .select("shop_id")
          .eq("user_id", user.id)
          .maybeSingle();
        if (data?.shop_id) {
          connected = true;
          shopId = data.shop_id;
        }
      }
    } catch {
      // session or query error
    }
  }

  return (
    <div className="space-y-8">
      <header>
        <StatusBadge label="Etsy" tone="neutral" />
        <h1 className="mt-3 text-3xl font-bold">Connect Etsy shop</h1>
        <p className="mt-2 max-w-2xl text-[var(--text-muted)]">
          Link your Etsy seller account so approved products can be created as
          Etsy drafts after the Review Gate, and so the daily poller can read your
          shop&apos;s views, favorites, and sales.
        </p>
      </header>

      <Panel title="Connection" glow={connected ? "blue" : "orange"}>
        {!configured ? (
          <p className="text-sm text-[var(--text-muted)]">
            Configure Supabase in{" "}
            <code className="text-[var(--accent-blue)]">.env.local</code> first.
          </p>
        ) : !signedIn ? (
          <>
            <p className="text-sm text-[var(--text-muted)]">
              Sign in to connect your Etsy shop.
            </p>
            <ButtonLink
              href="/login?next=/settings/etsy-connect"
              variant="primary"
              className="mt-4"
            >
              Sign in
            </ButtonLink>
          </>
        ) : connected ? (
          <dl className="space-y-3 text-sm">
            <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between">
              <dt className="text-[var(--text-muted)]">Status</dt>
              <dd className="font-medium text-[var(--foreground)]">Connected</dd>
            </div>
            <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between">
              <dt className="text-[var(--text-muted)]">Shop ID</dt>
              <dd className="font-mono text-xs text-[var(--foreground)]">{shopId}</dd>
            </div>
          </dl>
        ) : (
          <>
            <p className="text-sm text-[var(--text-muted)]">
              You will be redirected to Etsy to grant{" "}
              <span className="text-[var(--foreground)]">listings</span>,{" "}
              <span className="text-[var(--foreground)]">shop</span>, and{" "}
              <span className="text-[var(--foreground)]">sales</span> access.
            </p>
            {/* Plain anchor (NOT next/link): the browser must do a full top-level
                navigation so the OAuth-start route can set the PKCE state +
                verifier cookies and 307 to Etsy. A client-side Link/prefetch
                breaks that handshake and the callback then sees no cookies. */}
            <a
              href="/api/auth/etsy/connect"
              className="mt-4 inline-flex items-center justify-center gap-2 rounded-md bg-[var(--accent-orange)] px-4 py-2 text-sm font-semibold text-[#0b0e14] shadow-[0_0_20px_-4px_var(--accent-orange-glow)] transition hover:brightness-110"
            >
              Connect Etsy shop
            </a>
          </>
        )}
      </Panel>

      <p className="text-sm text-[var(--text-muted)]">
        <Link href="/settings" className="text-[var(--accent-blue)] hover:underline">
          Back to settings
        </Link>
      </p>
    </div>
  );
}
