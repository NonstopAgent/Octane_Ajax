"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type RejectModalProps = {
  open: boolean;
  productTitle: string;
  loading: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
};

export function RejectModal({
  open,
  productTitle,
  loading,
  onClose,
  onConfirm,
}: RejectModalProps) {
  if (!open) return null;

  return (
    <RejectModalDialog
      key={productTitle}
      productTitle={productTitle}
      loading={loading}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}

function RejectModalDialog({
  productTitle,
  loading,
  onClose,
  onConfirm,
}: Omit<RejectModalProps, "open">) {
  const [reason, setReason] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const id = window.setTimeout(() => textareaRef.current?.focus(), 50);
    return () => window.clearTimeout(id);
  }, []);

  const submit = () => {
    const trimmed = reason.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reject-modal-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        aria-label="Close"
        onClick={loading ? undefined : onClose}
      />
      <div className="factory-panel panel-glow-orange relative z-10 w-full max-w-md">
        <h2 id="reject-modal-title" className="text-lg font-bold">
          Reject listing
        </h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Tell Forge why{" "}
          <span className="text-[var(--foreground)]">{productTitle}</span> did
          not pass quality control.
        </p>

        <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Rejection reason{" "}
          <span className="text-[var(--accent-orange)]">*</span>
        </label>
        <textarea
          ref={textareaRef}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={4}
          disabled={loading}
          placeholder="e.g. Mockup style feels off-brand; try warmer tones and shorter title."
          className="mt-2 w-full resize-none rounded-md border border-[var(--border-dim)] bg-black/30 px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-orange)] focus:outline-none"
        />

        <div className="mt-4 flex gap-2">
          <Button
            variant="ghost"
            className="flex-1"
            disabled={loading}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            className="flex-1 bg-red-600 hover:bg-red-500"
            disabled={loading || !reason.trim()}
            onClick={submit}
          >
            {loading ? "Rejecting…" : "Reject listing"}
          </Button>
        </div>
      </div>
    </div>
  );
}
