import { Suspense } from "react";
import { AuthForm } from "@/components/auth/auth-form";
import { StatusBadge } from "@/components/ui/status-badge";
import { isSupabaseConfigured } from "@/lib/auth/env";

export default function LoginPage() {
  const configured = isSupabaseConfigured();

  return (
    <div className="factory-grid-bg factory-scanlines flex min-h-full flex-col items-center justify-center px-4 py-12">
      <div className="mb-8 text-center">
        <StatusBadge label="Octane Ajax" tone="blue" />
        <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
          SYS.AJAX.AUTH :: OPERATOR GATE
        </p>
      </div>

      {!configured ? (
        <div className="factory-panel max-w-md text-center">
          <h1 className="text-xl font-bold">Supabase not configured</h1>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Copy <code className="text-[var(--accent-blue)]">.env.example</code>{" "}
            to <code className="text-[var(--accent-blue)]">.env.local</code> and
            set your project URL and anon key, then restart{" "}
            <code className="text-[var(--accent-blue)]">npm run dev</code>.
          </p>
        </div>
      ) : (
        <Suspense
          fallback={
            <div className="factory-panel w-full max-w-md p-8 text-center text-sm text-[var(--text-muted)]">
              Loading auth…
            </div>
          }
        >
          <AuthForm />
        </Suspense>
      )}
    </div>
  );
}
