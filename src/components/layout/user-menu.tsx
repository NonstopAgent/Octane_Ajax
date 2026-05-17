"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export function UserMenu() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    void supabase.auth.getUser().then(({ data: { user } }) => {
      setEmail(user?.email ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    setSigningOut(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/login");
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {email ? (
        <span
          className="hidden max-w-[10rem] truncate font-mono text-[10px] text-[var(--text-muted)] sm:inline"
          title={email}
        >
          {email}
        </span>
      ) : (
        <Link
          href="/login"
          className="text-xs font-semibold text-[var(--accent-blue)] hover:underline"
        >
          Sign in
        </Link>
      )}
      <Button
        variant="ghost"
        className="!px-2 !py-1 text-[10px] uppercase tracking-wide"
        disabled={signingOut}
        onClick={() => void signOut()}
      >
        {signingOut ? "…" : "Sign out"}
      </Button>
    </div>
  );
}
