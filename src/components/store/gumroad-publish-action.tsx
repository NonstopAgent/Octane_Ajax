"use client";

import { useState } from "react";
import type { ListingStatus } from "@/lib/ajax/status";

type GumroadPublishActionProps = {
  listingId: string;
  status: ListingStatus;
  gumroadUrl: string | null;
  gumroadProductId?: string | null;
};

type PublishResponse = {
  ok?: boolean;
  status?: string;
  message?: string;
  url?: string | null;
  productId?: string | null;
  error?: string;
};

function canPublishToGumroad(status: ListingStatus): boolean {
  return status === "approved" || status === "published";
}

export function GumroadPublishAction({
  listingId,
  status,
  gumroadUrl,
  gumroadProductId,
}: GumroadPublishActionProps) {
  const [url, setUrl] = useState(gumroadUrl?.trim() || null);
  const [productId, setProductId] = useState(gumroadProductId ?? null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function publish() {
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(
        `/api/ajax/listings/${encodeURIComponent(listingId)}/publish-gumroad`,
        { method: "POST" },
      );
      const body = (await response.json()) as PublishResponse;

      if (!response.ok || !body.ok) {
        throw new Error(body.message ?? body.error ?? "Gumroad publish failed.");
      }

      if (!body.url) {
        throw new Error("Gumroad publish completed without a checkout URL.");
      }

      setUrl(body.url);
      setProductId(body.productId ?? null);
      setMessage(body.message ?? "Published to Gumroad.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gumroad publish failed.");
    } finally {
      setBusy(false);
    }
  }

  if (url) {
    return (
      <div className="space-y-2">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-10 items-center justify-center rounded-md border border-[var(--accent-blue)] px-4 text-sm font-medium text-[var(--accent-blue)] transition hover:bg-[var(--accent-blue)]/10"
        >
          View on Gumroad
        </a>
        {productId ? (
          <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
            Product ID: {productId}
          </p>
        ) : null}
        {message ? (
          <p className="text-xs text-[var(--accent-blue)]">{message}</p>
        ) : null}
      </div>
    );
  }

  if (!canPublishToGumroad(status)) return null;

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={publish}
        disabled={busy}
        className="factory-control factory-control-approve inline-flex h-10 items-center justify-center px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Publishing..." : "Publish to Gumroad"}
      </button>
      {error ? (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      ) : (
        <p className="text-xs text-[var(--text-muted)]">
          Uses the server-side Gumroad repair route and the private generated PDF.
        </p>
      )}
    </div>
  );
}
