import Link from "next/link";
import { StoreListingCard } from "@/components/store/store-listing-card";
import { CommandHeader } from "@/components/layout/command-header";
import { ButtonLink } from "@/components/ui/button";
import type { StoreListingDetail } from "@/lib/store/types";

type StoreDashboardProps = {
  listings: StoreListingDetail[];
  isAuthenticated: boolean;
  configReady: boolean;
};

export function StoreDashboard({
  listings,
  isAuthenticated,
  configReady,
}: StoreDashboardProps) {
  if (!configReady) {
    return (
      <Callout
        title="Supabase not configured"
        body="Add Supabase env vars to .env.local to preview your internal storefront."
      />
    );
  }

  if (!isAuthenticated) {
    return (
      <Callout
        title="Sign in required"
        body="The storefront prototype is private. Sign in to browse approved and published listings you own."
        href="/login?next=/store"
        hrefLabel="Sign in"
      />
    );
  }

  const publishedCount = listings.filter(
    (item) => item.displayStatus === "published",
  ).length;
  const approvedCount = listings.length - publishedCount;

  return (
    <div className="space-y-6">
      <CommandHeader
        badge="Internal channel"
        badgeTone="blue"
        title="Storefront"
        description="Prototype catalog of listings that passed the Review Gate — approved and demo-published units for your operator account only. PDFs download through authenticated API routes, not public buckets."
        aside={
          <ButtonLink href="/review" variant="secondary">
            Review Gate
          </ButtonLink>
        }
        sysline="SYS.AJAX.STORE :: PRIVATE"
      />

      <div className="factory-panel border-[var(--border-dim)] px-4 py-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--accent-blue)]">
          Catalog status
        </p>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {listings.length} listing{listings.length === 1 ? "" : "s"} ·{" "}
          {approvedCount} approved · {publishedCount} published
        </p>
      </div>

      {listings.length === 0 ? (
        <div className="factory-panel panel-glow-blue text-center">
          <p className="text-lg font-semibold">No storefront listings yet</p>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Approve a listing at the Review Gate, then run Pixel to publish to
            the demo storefront.
          </p>
          <ButtonLink href="/factory" variant="primary" className="mt-6">
            Open factory floor
          </ButtonLink>
        </div>
      ) : (
        <ul className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {listings.map((item) => (
            <li key={item.listing.id}>
              <StoreListingCard item={item} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Callout({
  title,
  body,
  href,
  hrefLabel,
}: {
  title: string;
  body: string;
  href?: string;
  hrefLabel?: string;
}) {
  return (
    <div className="factory-panel panel-glow-orange max-w-xl">
      <h1 className="text-xl font-bold">{title}</h1>
      <p className="mt-2 text-sm text-[var(--text-muted)]">{body}</p>
      {href && hrefLabel ? (
        <Link
          href={href}
          className="mt-4 inline-flex text-sm font-semibold text-[var(--accent-blue)] hover:underline"
        >
          {hrefLabel} →
        </Link>
      ) : null}
    </div>
  );
}
