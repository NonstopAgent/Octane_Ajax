"use client";

import { useState } from "react";
import type { ProductListing } from "@/lib/ajax/types";
import { getStatusLabel } from "@/lib/ajax/status";
import { formatStorePrice } from "@/lib/store/display";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";

type ReviewExternalLinksPanelProps = {
  listings: ProductListing[];
  /** Retained for API compatibility with the review dashboard; unused. */
  onPublished?: (listingId: string) => void;
};

/**
 * Approved listings + their Etsy draft status. Approving a product auto-creates
 * an Etsy DRAFT in the background (see runPostApproval); the Etsy listing URL is
 * stored on the listing's gumroad_url column (legacy name, reused). This panel
 * surfaces that draft link, or lets the operator (re)create it on demand. No
 * Lemon Squeezy / Gumroad / digital-download publishing — Octane Ajax is POD.
 */
export function ReviewExternalLinksPanel({
  listings,
}: ReviewExternalLinksPanelProps) {
  if (listings.length === 0) return null;

  return (
    <section className="space-y-4" aria-labelledby="approved-listings-heading">
      <div className="factory-panel border-[var(--border-dim)] px-4 py-3">
        <h2
          id="approved-listings-heading"
          className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--accent-blue)]"
        >
          Approved — Etsy drafts
        </h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Approving a listing publishes it to your Etsy shop via Printify (your Etsy
          shop must be connected inside Printify, set to &quot;Publish as draft&quot;).
          Printify builds the full listing — variants, pricing, shipping — then you
          publish it live from Etsy.
        </p>
      </div>

      <ul className="space-y-4">
        {listings.map((listing) => (
          <li key={listing.id}>
            <EtsyDraftCard listing={listing} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function EtsyDraftCard({ listing }: { listing: ProductListing }) {
  // gumroad_* columns are reused to store the Etsy listing link + id.
  const [etsyUrl, setEtsyUrl] = useState(listing.gumroadUrl?.trim() || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = listing.title ?? "Untitled product";

  const createDraft = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/ajax/listings/${listing.id}/etsy-draft`, {
        method: "POST",
        credentials: "include",
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        etsyUrl?: string;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.etsyUrl) {
        setError(data.error ?? "Could not create the Etsy draft.");
        return;
      }
      setEtsyUrl(data.etsyUrl);
    } catch {
      setError("Network error creating the Etsy draft.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="factory-panel">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border-dim)] pb-3">
        <div>
          <StatusBadge label={getStatusLabel(listing.status)} tone="blue" />
          <h3 className="mt-2 font-semibold text-[var(--foreground)]">{title}</h3>
        </div>
        <p className="font-mono text-lg font-bold text-[var(--accent-orange)]">
          {formatStorePrice(listing.price)}
        </p>
      </header>

      {etsyUrl ? (
        <div className="mt-4 space-y-3">
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
              Published via Printify
            </span>
            <p className="mt-1 break-all rounded-md border border-[var(--border-dim)] bg-black/30 px-3 py-2 text-sm text-[var(--foreground)]">
              {etsyUrl}
            </p>
          </div>
          <a
            href={etsyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-10 items-center justify-center rounded-md border border-[var(--accent-blue)] px-4 text-sm font-medium text-[var(--accent-blue)] transition hover:bg-[var(--accent-blue)]/10"
          >
            Open in Printify
          </a>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-[var(--text-muted)]">
            Not published yet. It&apos;s normally published automatically on approval —
            click below to publish now. Requires the product&apos;s Printify product
            (from fulfillment) and your Etsy shop connected inside Printify.
          </p>
          <Button onClick={createDraft} disabled={busy}>
            {busy ? "Publishing to Etsy…" : "Publish to Etsy"}
          </Button>
          {error && (
            <p className="text-sm text-[var(--accent-orange)]">{error}</p>
          )}
        </div>
      )}
    </article>
  );
}
