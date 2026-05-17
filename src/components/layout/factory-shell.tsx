"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserMenu } from "@/components/layout/user-menu";
import { NAV_ITEMS } from "@/lib/constants";

export function FactoryShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="factory-grid-bg factory-scanlines relative flex min-h-full flex-col">
      <header className="border-b border-[var(--border-dim)] bg-[var(--surface)]/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-4 py-4 sm:px-6">
          <Link href="/" className="group flex items-center gap-3">
            <span className="factory-logo-mark" aria-hidden />
            <span>
              <span className="block text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent-blue)]">
                Octane
              </span>
              <span className="block text-lg font-bold leading-none text-[var(--foreground)]">
                Ajax
              </span>
            </span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-md px-3 py-2 text-sm font-medium transition ${
                    active
                      ? "bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]"
                      : "text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--foreground)]"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <UserMenu />
        </div>
        <nav
          className="flex gap-1 overflow-x-auto border-t border-[var(--border-dim)] px-4 py-2 md:hidden"
          aria-label="Mobile"
        >
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium ${
                  active
                    ? "bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]"
                    : "text-[var(--text-muted)]"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="relative z-10 mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
        {children}
      </main>
    </div>
  );
}
