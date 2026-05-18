"use client";

import { useState } from "react";
import type { ProductListing } from "@/lib/ajax/types";
import { getStatusLabel } from "@/lib/ajax/status";
import { GumroadPublishAction } from "@/components/store/gumroad-publish-action";
import { formatStorePrice } from "@/lib/store/display";
import { StatusBadge } from "@/components/ui/status-badge";

type ReviewExternalLinksPanelProps = {
  listings: ProductListing[];
  onPublished?: (listingId: string) => void;
};

export function ReviewExternalLinksPanel({
  listings,
  onPublished,
}: ReviewExternalLinksPanelProps) {
  if (listings.length === 0) return null;

  return (
    <section className="space-y-4" aria-labelledby="external-links-heading">
      <div className="factory-panel border-[var(--border-dim)] px-4 py-3">
        <h2
          id="external-links-heading"
          className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--accent-blue)]"
        >
          External links — store checkout
        </h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Listings with a checkout URL appear on the public{" "}
          <span className="text-[var(--foreground)]">/store</span> catalog.
          When Lemon Squeezy is configured, approval creates the store product.
          Etsy auto-publish runs when Etsy is connected in Settings.
        </p>
      </div>

      <ul className="space-y-4">
        {listings.map((listing) => (
          <li key={listing.id}>
            <GumroadListingCard listing={listing} onPublished={onPublished} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function GumroadListingCard({
  listing,
  onPublished,
}: {
  listing: ProductListing;
  onPublished?: (listingId: string) => void;
}) {
  const [gumroadUrl, setGumroadUrl] = useState(listing.gumroadUrl?.trim() || null);
  const title = listing.title ?? "Untitled product";

  return (
    <article className="factory-panel">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border-dim)] pb-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge
              label={getStatusLabel(listing.status)}
              tone="blue"
            />
          </div>
          <h3 className="mt-2 font-semibold text-[var(--foreground)]">{title}</h3>
        </div>
        <p className="font-mono text-lg font-bold text-[var(--accent-orange)]">
          {formatStorePrice(listing.price)}
        </p>
      </header>

      {gumroadUrl ? (
        <GumroadPublishedBlock gumroadUrl={gumroadUrl} />
      ) : (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-[var(--text-muted)]">
            No checkout URL yet. Retry server-side publishing after confirming
            the listing PDF is ready, or paste a URL manually.
          </p>
          <GumroadPublishAction
            listingId={listing.id}
            status={listing.status}
            gumroadUrl={listing.gumroadUrl}
            gumroadProductId={listing.gumroadProductId}
            onPublished={(url) => {
              setGumroadUrl(url);
              onPublished?.(listing.id);
            }}
          />
        </div>
      )}
    </article>
  );
}

function GumroadPublishedBlock({ gumroadUrl }: { gumroadUrl: string }) {
  return (
    <div className="mt-4 space-y-3">
      <div>
        <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
          Checkout URL
        </span>
        <p className="mt-1 break-all rounded-md border border-[var(--border-dim)] bg-black/30 px-3 py-2 text-sm text-[var(--foreground)]">
          {gumroadUrl}
        </p>
      </div>
      <a
        href={gumroadUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-10 items-center justify-center rounded-md border border-[var(--accent-blue)] px-4 text-sm font-medium text-[var(--accent-blue)] transition hover:bg-[var(--accent-blue)]/10"
      >
        Open checkout
      </a>
    </div>
  );
}
