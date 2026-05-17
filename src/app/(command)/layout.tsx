import { FactoryShell } from "@/components/layout/factory-shell";

/** Auth-aware pages use cookies — must not static-prerender at build time. */
export const dynamic = "force-dynamic";

export default function CommandLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <FactoryShell>{children}</FactoryShell>;
}
