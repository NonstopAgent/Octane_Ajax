import { reviewQcPanelWarn } from "@/components/review/review-panel-styles";
import { collectComplianceMessages } from "@/lib/review/display";
import type { ComplianceFlag } from "@/lib/product/domain";

type ReviewCompliancePanelProps = {
  warnings: string[];
  flags: ComplianceFlag[];
};

export function ReviewCompliancePanel({
  warnings,
  flags,
}: ReviewCompliancePanelProps) {
  const items = collectComplianceMessages({ warnings, flags });
  if (items.length === 0) return null;

  return (
    <section
      className={reviewQcPanelWarn}
      aria-labelledby="review-compliance-heading"
    >
      <p
        id="review-compliance-heading"
        className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--accent-orange)]"
      >
        Compliance warnings
      </p>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        Review before approving — policy or claim issues detected in generated
        copy.
      </p>
      <ul className="mt-3 space-y-2">
        {items.map((item, index) => (
          <li
            key={`${item.message}-${index}`}
            className={`flex gap-2 rounded-md border px-3 py-2 text-sm ${
              item.severity === "block"
                ? "border-red-500/40 bg-red-500/10 text-red-100"
                : item.severity === "warning"
                  ? "border-amber-500/35 bg-amber-500/8 text-[var(--foreground)]"
                  : "border-[var(--border-dim)] bg-black/20 text-[var(--foreground)]"
            }`}
          >
            <span className="shrink-0 font-mono text-xs uppercase tracking-wide opacity-80">
              {item.severity === "block" ? "BLOCK" : item.severity === "warning" ? "WARN" : "INFO"}
            </span>
            <span>{item.message}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
