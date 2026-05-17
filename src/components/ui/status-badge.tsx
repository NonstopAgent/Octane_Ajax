type StatusBadgeProps = {
  label: string;
  tone?: "blue" | "orange" | "neutral" | "warning";
};

const toneClass = {
  blue: "border-[var(--accent-blue)]/40 text-[var(--accent-blue)] bg-[var(--accent-blue)]/10",
  orange:
    "border-[var(--accent-orange)]/40 text-[var(--accent-orange)] bg-[var(--accent-orange)]/10",
  neutral: "border-[var(--border-dim)] text-[var(--text-muted)] bg-white/5",
  warning: "border-amber-500/40 text-amber-400 bg-amber-500/10",
};

export function StatusBadge({ label, tone = "neutral" }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium uppercase tracking-wide ${toneClass[tone]}`}
    >
      {label}
    </span>
  );
}
