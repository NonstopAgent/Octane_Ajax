import type { ReactNode } from "react";
import Link from "next/link";
import { Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { ButtonLink } from "@/components/ui/button";
import { isSupabaseConfigured } from "@/lib/auth/env";
import { createClient } from "@/lib/supabase/server";

export default async function SettingsPage() {
  const configured = isSupabaseConfigured();
  let user: { id: string; email?: string } | null = null;

  if (configured) {
    try {
      const supabase = await createClient();
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser();
      if (authUser) {
        user = { id: authUser.id, email: authUser.email };
      }
    } catch {
      // env present but session/client error
    }
  }

  return (
    <div className="space-y-8">
      <header>
        <StatusBadge label="Configuration" tone="neutral" />
        <h1 className="mt-3 text-3xl font-bold">Settings</h1>
        <p className="mt-2 max-w-2xl text-[var(--text-muted)]">
          Local demo status, Supabase connection, and operator session.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Supabase" glow={configured ? "blue" : "orange"}>
          <dl className="space-y-3 text-sm">
            <Row
              label="Env configured"
              value={configured ? "Yes" : "No — add .env.local"}
              ok={configured}
            />
            <Row
              label="URL"
              value={
                configured
                  ? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "—"
                  : "Missing NEXT_PUBLIC_SUPABASE_URL"
              }
              ok={configured}
            />
          </dl>
          {!configured && (
            <p className="mt-4 text-xs text-[var(--text-muted)]">
              Copy <code className="text-[var(--accent-blue)]">.env.example</code>{" "}
              → <code className="text-[var(--accent-blue)]">.env.local</code>,
              restart <code className="text-[var(--accent-blue)]">npm run dev</code>.
            </p>
          )}
        </Panel>

        <Panel title="Operator session" glow={user ? "blue" : "orange"}>
          {user ? (
            <dl className="space-y-3 text-sm">
              <Row label="Signed in" value="Yes" ok />
              <Row label="Email" value={user.email ?? "—"} ok />
              <Row
                label="User ID"
                value={
                  <span className="break-all font-mono text-xs">{user.id}</span>
                }
                ok
              />
            </dl>
          ) : (
            <>
              <p className="text-sm text-[var(--text-muted)]">
                Not signed in. Command routes require an operator session.
              </p>
              <ButtonLink href="/login" variant="primary" className="mt-4">
                Sign in
              </ButtonLink>
            </>
          )}
        </Panel>
      </div>

      <Panel title="Demo mode" glow="orange">
        <ul className="space-y-2 text-sm text-[var(--text-muted)]">
          <li>Simulated Nova → Forge → Review → Pixel pipeline: enabled</li>
          <li>Realtime factory floor: {configured ? "ready when signed in" : "needs Supabase"}</li>
          <li>External integrations: stubbed (server-only adapters)</li>
        </ul>
      </Panel>

      <Panel title="Next steps">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-[var(--text-muted)]">
          <li>Create a Supabase project and apply migrations (see README).</li>
          <li>Enable Email provider under Authentication → Providers.</li>
          <li>
            For local dev, disable email confirmation under Authentication →
            Providers → Email (optional but recommended).
          </li>
          <li>
            <Link href="/login" className="text-[var(--accent-blue)] hover:underline">
              Sign up or sign in
            </Link>
            , then open the{" "}
            <Link href="/factory" className="text-[var(--accent-blue)] hover:underline">
              factory floor
            </Link>
            .
          </li>
        </ol>
      </Panel>
    </div>
  );
}

function Row({
  label,
  value,
  ok,
}: {
  label: string;
  value: ReactNode;
  ok?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between">
      <dt className="text-[var(--text-muted)]">{label}</dt>
      <dd
        className={
          ok
            ? "font-medium text-[var(--foreground)]"
            : "font-medium text-[var(--accent-orange)]"
        }
      >
        {value}
      </dd>
    </div>
  );
}
