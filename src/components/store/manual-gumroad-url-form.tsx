"use client";

import { useState } from "react";

type ManualGumroadUrlFormProps = {
  listingId: string;
  onSaved?: (url: string) => void;
};

type SaveResponse = {
  ok?: boolean;
  gumroadUrl?: string | null;
  error?: string;
  message?: string;
};

export function ManualGumroadUrlForm({
  listingId,
  onSaved,
}: ManualGumroadUrlFormProps) {
  const [inputUrl, setInputUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function saveUrl() {
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(
        `/api/ajax/listings/${encodeURIComponent(listingId)}/gumroad-url`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gumroadUrl: inputUrl }),
        },
      );
      const body = (await response.json()) as SaveResponse;

      if (!response.ok || !body.ok || !body.gumroadUrl) {
        throw new Error(body.error ?? body.message ?? "Failed to save URL.");
      }

      setMessage(body.message ?? "Checkout URL saved.");
      onSaved?.(body.gumroadUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save URL.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 border-t border-[var(--border-dim)] pt-3">
      <p className="text-xs font-medium text-[var(--text-muted)]">
        Or paste Gumroad URL manually
      </p>
      <input
        type="url"
        value={inputUrl}
        onChange={(event) => setInputUrl(event.target.value)}
        placeholder="https://your-store.lemonsqueezy.com/checkout/buy/..."
        className="factory-control w-full px-3 py-2 text-sm"
        disabled={busy}
      />
      <button
        type="button"
        onClick={saveUrl}
        disabled={busy || !inputUrl.trim()}
        className="factory-control inline-flex h-9 items-center justify-center px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Saving..." : "Save URL"}
      </button>
      {error ? (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="text-xs text-[var(--accent-blue)]">{message}</p>
      ) : null}
    </div>
  );
}
