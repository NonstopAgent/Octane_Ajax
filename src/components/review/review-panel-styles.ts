/** Shared Tailwind classes for Review Gate QC panels. */
export const reviewQcPanel =
  "rounded-lg border border-[var(--border-dim)] bg-black/20 px-4 py-3";

export const reviewQcPanelWarn =
  "rounded-lg border border-[var(--accent-orange)]/35 bg-[var(--accent-orange)]/5 px-4 py-3";

export const reviewQcPanelMuted =
  "rounded-lg border border-dashed border-[var(--border-dim)] bg-black/10 px-4 py-3 opacity-90";

export const reviewPhase2Strip =
  "mt-6 space-y-4 border-t border-[var(--border-dim)] pt-5";

export const reviewStructureJson =
  "mt-3 max-h-56 overflow-x-auto rounded-md border border-[var(--border-dim)] bg-black/30 p-3 font-mono text-xs text-[var(--foreground)]";

export const pdfPreviewSlot =
  "mt-3 flex min-h-[8.5rem] flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-[var(--accent-blue)]/30 bg-[repeating-linear-gradient(-45deg,rgba(0,0,0,0.18),rgba(0,0,0,0.18)_8px,rgba(0,212,255,0.03)_8px,rgba(0,212,255,0.03)_16px)] p-4 text-center";

export const pdfPreviewIcon = "text-3xl text-[var(--accent-blue)] opacity-65";
