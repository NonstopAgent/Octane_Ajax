"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

type AuthMode = "signin" | "signup";

export function AuthForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/factory";
  const callbackError = searchParams.get("error");

  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(
    callbackError === "auth_callback"
      ? "Sign-in callback failed. Try again."
      : null,
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const supabase = createClient();

      if (mode === "signup") {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
        });

        if (signUpError) {
          setError(signUpError.message);
          return;
        }

        if (data.session) {
          router.push(next);
          router.refresh();
          return;
        }

        setMessage(
          "Account created. If email confirmation is enabled in Supabase, check your inbox — otherwise sign in below.",
        );
        setMode("signin");
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        setError(signInError.message);
        return;
      }

      router.push(next);
      router.refresh();
    } catch {
      setError("Could not reach Supabase. Check .env.local and restart the dev server.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="factory-panel panel-glow-blue w-full max-w-md">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--accent-blue)]">
        Operator access
      </p>
      <h1 className="mt-2 text-2xl font-bold">
        {mode === "signin" ? "Sign in" : "Create account"}
      </h1>
      <p className="mt-2 text-sm text-[var(--text-muted)]">
        Email and password auth for your local demo factory.
      </p>

      <div className="mt-4 flex gap-2 rounded-md border border-[var(--border-dim)] bg-black/25 p-1">
        <button
          type="button"
          className={`flex-1 rounded px-3 py-2 text-xs font-semibold uppercase tracking-wide transition ${
            mode === "signin"
              ? "bg-[var(--accent-blue)]/20 text-[var(--accent-blue)]"
              : "text-[var(--text-muted)] hover:text-[var(--foreground)]"
          }`}
          onClick={() => setMode("signin")}
        >
          Sign in
        </button>
        <button
          type="button"
          className={`flex-1 rounded px-3 py-2 text-xs font-semibold uppercase tracking-wide transition ${
            mode === "signup"
              ? "bg-[var(--accent-orange)]/20 text-[var(--accent-orange)]"
              : "text-[var(--text-muted)] hover:text-[var(--foreground)]"
          }`}
          onClick={() => setMode("signup")}
        >
          Sign up
        </button>
      </div>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label
            htmlFor="email"
            className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]"
          >
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-2 w-full rounded-md border border-[var(--border-dim)] bg-black/30 px-3 py-2 text-sm focus:border-[var(--accent-blue)] focus:outline-none"
            placeholder="operator@factory.local"
          />
        </div>
        <div>
          <label
            htmlFor="password"
            className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]"
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete={
              mode === "signup" ? "new-password" : "current-password"
            }
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-2 w-full rounded-md border border-[var(--border-dim)] bg-black/30 px-3 py-2 text-sm focus:border-[var(--accent-blue)] focus:outline-none"
            placeholder="••••••••"
          />
        </div>

        {error && (
          <p className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}
        {message && (
          <p className="rounded border border-[var(--accent-blue)]/30 bg-[var(--accent-blue)]/10 px-3 py-2 text-sm text-[var(--accent-blue)]">
            {message}
          </p>
        )}

        <Button
          type="submit"
          variant="primary"
          className="factory-control factory-control-primary h-11 w-full"
          disabled={loading}
        >
          {loading
            ? "Working…"
            : mode === "signin"
              ? "Enter factory"
              : "Create operator account"}
        </Button>
      </form>

      <p className="mt-6 text-center text-xs text-[var(--text-muted)]">
        <Link href="/" className="text-[var(--accent-blue)] hover:underline">
          ← Back to landing
        </Link>
      </p>
    </div>
  );
}
