"use client";

export type ToastTone = "success" | "error" | "info";

export type ToastState = {
  tone: ToastTone;
  message: string;
} | null;

const toneStyles: Record<ToastTone, string> = {
  success:
    "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  error: "border-red-500/40 bg-red-500/10 text-red-300",
  info: "border-[var(--accent-blue)]/40 bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]",
};

export function ToastBanner({ toast }: { toast: ToastState }) {
  if (!toast) return null;

  return (
    <div
      role="status"
      className={`factory-toast animate-toast-in rounded-md border px-4 py-3 text-sm font-medium ${toneStyles[toast.tone]}`}
    >
      {toast.message}
    </div>
  );
}
