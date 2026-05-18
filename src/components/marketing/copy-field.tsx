"use client";

import { useCallback, useState } from "react";

type CopyFieldProps = {
  label: string;
  value: string;
  multiline?: boolean;
};

export function CopyField({ label, value, multiline = false }: CopyFieldProps) {
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [value]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--accent-blue)]">
          {label}
        </p>
        <button
          type="button"
          onClick={onCopy}
          className="rounded-md border border-[var(--border-dim)] px-2.5 py-1 text-xs font-medium text-[var(--text-muted)] transition hover:border-[var(--accent-blue)]/40 hover:text-[var(--foreground)]"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {multiline ? (
        <pre className="whitespace-pre-wrap rounded-md border border-[var(--border-dim)] bg-black/20 p-3 text-sm text-[var(--foreground)]">
          {value}
        </pre>
      ) : (
        <p className="rounded-md border border-[var(--border-dim)] bg-black/20 p-3 text-sm text-[var(--foreground)]">
          {value}
        </p>
      )}
    </div>
  );
}
