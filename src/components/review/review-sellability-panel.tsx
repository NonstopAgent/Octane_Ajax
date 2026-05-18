import { reviewQcPanel } from "@/components/review/review-panel-styles";
import {
  evaluateSellabilityChecklist,
  type SellabilityCheckItem,
  type SellabilityInput,
} from "@/lib/review/sellability";

type ReviewSellabilityPanelProps = SellabilityInput;

export function ReviewSellabilityPanel(props: ReviewSellabilityPanelProps) {
  const checklist = evaluateSellabilityChecklist(props);

  return (
    <section
      className={reviewQcPanel}
      aria-labelledby="review-sellability-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          id="review-sellability-heading"
          className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--accent-blue)]"
        >
          Sellability checklist
        </p>
        <p
          className={`font-mono text-[10px] uppercase tracking-wider ${
            checklist.allPassed
              ? "text-[var(--accent-blue)]"
              : "text-[var(--text-muted)]"
          }`}
        >
          {checklist.passedCount}/{checklist.totalCount} passed
        </p>
      </div>

      <ul className="mt-3 space-y-2" role="list">
        {checklist.checks.map((item) => (
          <SellabilityRow key={item.id} item={item} />
        ))}
      </ul>
    </section>
  );
}

function SellabilityRow({ item }: { item: SellabilityCheckItem }) {
  return (
    <li className="flex items-start gap-2 rounded-md border border-[var(--border-dim)] bg-black/20 px-3 py-2 text-xs">
      <span
        className={
          item.passed
            ? "font-mono text-[var(--accent-blue)]"
            : "font-mono text-[var(--accent-orange)]"
        }
        aria-hidden
      >
        {item.passed ? "✓" : "✗"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-[var(--foreground)]">{item.label}</p>
        {item.detail ? (
          <p className="mt-0.5 text-[var(--text-muted)]">{item.detail}</p>
        ) : null}
      </div>
    </li>
  );
}
