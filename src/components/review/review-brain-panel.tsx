import {
  BRAIN_SCORE_DIMENSIONS,
  brainVerdictTone,
  formatBrainVerdictLabel,
  formatRiskLevel,
  scoreBarPercent,
} from "@/lib/review/display";
import type { ProductIdeaBrainSnapshot } from "@/lib/product/domain";
import { reviewQcPanel } from "@/components/review/review-panel-styles";
import { StatusBadge } from "@/components/ui/status-badge";

type ReviewBrainPanelProps = {
  brain: ProductIdeaBrainSnapshot;
};

export function ReviewBrainPanel({ brain }: ReviewBrainPanelProps) {
  const { score, validation, verdict, evaluatedAt } = brain;
  const risk = formatRiskLevel(validation.riskLevel);
  const evaluatedLabel = new Date(evaluatedAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <section
      className={reviewQcPanel}
      aria-labelledby="review-brain-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p
            id="review-brain-heading"
            className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--accent-blue)]"
          >
            Product Brain
          </p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Automated idea scoring before Forge generation.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge
            label={formatBrainVerdictLabel(verdict)}
            tone={brainVerdictTone(verdict)}
          />
          <StatusBadge label={risk.label} tone={risk.tone} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
            Total score
          </p>
          <p className="font-mono text-4xl font-bold tabular-nums text-[var(--accent-blue)]">
            {score.totalScore}
            <span className="text-lg text-[var(--text-muted)]">/100</span>
          </p>
        </div>
        <p className="text-xs text-[var(--text-muted)]">
          Evaluated {evaluatedLabel}
        </p>
      </div>

      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {BRAIN_SCORE_DIMENSIONS.map(({ key, label, invert }) => (
          <li key={key}>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-[var(--text-muted)]">{label}</span>
              <span className="font-mono tabular-nums text-[var(--foreground)]">
                {score[key]}
              </span>
            </div>
            <div
              className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/30"
              role="presentation"
            >
              <div
                className={`h-full rounded-full ${invert ? "bg-[var(--accent-orange)]" : "bg-[var(--accent-blue)]"}`}
                style={{
                  width: `${scoreBarPercent(score[key], invert)}%`,
                }}
              />
            </div>
          </li>
        ))}
      </ul>

      {validation.violations.length > 0 && (
        <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-400">
            Validation flags
          </p>
          <ul className="mt-2 space-y-1 text-sm text-[var(--foreground)]">
            {validation.violations.map((v) => (
              <li key={v} className="flex gap-2">
                <span className="text-amber-400" aria-hidden>
                  △
                </span>
                <span>{v}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
