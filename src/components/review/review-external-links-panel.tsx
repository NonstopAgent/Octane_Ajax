"use client";

import { useState } from "react";
import type { ProductListing } from "@/lib/ajax/types";
import { getStatusLabel } from "@/lib/ajax/status";
import { formatStorePrice } from "@/lib/store/display";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";

type ReviewExternalLinksPanelProps = {
  listings: ProductListing[];
  onPublished: (listingId: string) => void;
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
          External links — publish to store
        </h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          After Review Gate approval, paste your Gumroad product URL to publish on
          the public <span className="text-[var(--foreground)]">/store</span>{" "}
          catalog. Pixel may still run for demo marketing; Gumroad is the
          buyer checkout path.
        </p>
      </div>

      <ul className="space-y-4">
        {listings.map((listing) => (
          <li key={listing.id}>
            <GumroadPublishCard
              listing={listing}
              onPublished={() => onPublished(listing.id)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function GumroadPublishCard({
  listing,
  onPublished,
}: {
  listing: ProductListing;
  onPublished: () => void;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title = listing.title ?? "Untitled product";

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/ajax/listings/${listing.id}/publish`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gumroadUrl: url }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Publish failed.");
        return;
      }
      onPublished();
    } catch {
      setError("Network error while publishing.");
    } finally {
      setBusy(false);
    }
  };

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

      <label className="mt-4 block">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
          Gumroad product URL
        </span>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://yourname.gumroad.com/l/product-slug"
          className="mt-1 w-full rounded-md border border-[var(--border-dim)] bg-black/30 px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-blue)] focus:outline-none"
          disabled={busy}
        />
      </label>

      {error ? (
        <p className="mt-2 text-sm text-red-300" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-3">
        <Button
          variant="primary"
          className="factory-control factory-control-approve h-10"
          disabled={busy || !url.trim()}
          onClick={save}
        >
          {busy ? "Saving…" : "Save & publish to store"}
        </Button>
      </div>
    </article>
  );
}
