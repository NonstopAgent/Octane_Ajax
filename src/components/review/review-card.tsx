"use client";

import { type ReactNode } from "react";
import { ReviewPhase2Section } from "@/components/review/review-phase2-section";
import { getStatusLabel } from "@/lib/ajax/status";
import { buildSellabilityInputFromGeneration } from "@/lib/review/approval-guards";
import {
  getReviewApproveUi,
  hasComplianceRisk,
} from "@/lib/review/display";
import { evaluateSellabilityChecklist } from "@/lib/review/sellability";
import type { PendingReviewDetail } from "@/lib/review/types";
import type { GenerationStatus } from "@/lib/supabase/schema";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";

function formatCreated(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export type AiReviewResult = {
  verdict: "approve" | "revise" | "reject";
  overallScore: number;
  subscores: {
    seo: number;
    sellability: number;
    brand: number;
    quality: number;
    compliance: number;
  };
  reasons: string[];
  fixes: string[];
  model: string;
  acted: "approved" | "rejected" | null;
};

type ReviewCardProps = {
  review: PendingReviewDetail;
  busy: boolean;
  approveError?: string | null;
  aiResult?: AiReviewResult | null;
  aiBusy?: boolean;
  onAiReview?: () => void;
  onApprove: () => void;
  onReject: () => void;
  onGenerationChange?: (patch: {
    generationStatus: GenerationStatus;
    storagePath?: string | null;
  }) => void;
};

export function ReviewCard({
  review,
  busy,
  approveError,
  aiResult,
  aiBusy,
  onAiReview,
  onApprove,
  onReject,
  onGenerationChange,
}: ReviewCardProps) {
  const { listing, idea, phase2 } = review;
  const sellabilityInput = buildSellabilityInputFromGeneration(
    phase2.generation,
    idea?.rawPayload,
  );
  const sellability = evaluateSellabilityChecklist(sellabilityInput);
  const approveUi = getReviewApproveUi(phase2.brain?.verdict, {
    sellabilityAllPassed: sellability.allPassed,
    sellability,
  });
  const title = listing.title ?? idea?.title ?? "Untitled product";
  const description =
    listing.description ?? idea?.description ?? "No description provided.";
  const niche = idea?.niche ?? "—";
  const keywords = idea?.seoKeywords ?? [];
  const trendScore = idea?.trendScore ?? 0;
  const approveDisabled = busy || approveUi.disabled;

  const showBlockedBanner =
    Boolean(approveUi.approvalBlockedHeading) &&
    approveUi.blockedCheckLabels.length > 0;

  return (
    <article className="review-card">
      {showBlockedBanner ? (
        <div
          className="mb-4 rounded-md border border-[var(--border-dim)] bg-black/25 px-4 py-3 text-sm text-[var(--text-muted)]"
          role="alert"
        >
          <p className="font-medium text-[var(--foreground)]">
            {approveUi.approvalBlockedHeading}
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {approveUi.blockedCheckLabels.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
          {approveUi.complianceBlockMessage ? (
            <p className="mt-3 text-red-200">{approveUi.complianceBlockMessage}</p>
          ) : null}
        </div>
      ) : null}

      {approveUi.disabledReason && !showBlockedBanner ? (
        <div
          className="mb-4 rounded-md border border-[var(--border-dim)] bg-black/25 px-4 py-3 text-sm text-[var(--text-muted)]"
          role="alert"
        >
          {approveUi.disabledReason}
        </div>
      ) : null}

      {approveError ? (
        <div
          className="mb-4 rounded-md border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-100"
          role="alert"
        >
          {approveError}
        </div>
      ) : null}

      <header className="flex flex-col gap-3 border-b border-[var(--border-dim)] pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge label="Pending review" tone="warning" />
            {phase2.brain ? (
              <StatusBadge
                label={`Brain ${phase2.brain.score.totalScore}`}
                tone="blue"
              />
            ) : null}
            {phase2.generation &&
            hasComplianceRisk({
              warnings: phase2.generation.complianceWarnings,
              flags: phase2.generation.complianceFlags,
            }) ? (
              <StatusBadge label="Compliance flags" tone="orange" />
            ) : null}
            {phase2.brain?.verdict === "needs_revision" ? (
              <StatusBadge label="Needs revision" tone="warning" />
            ) : null}
            {phase2.brain?.verdict === "blocked" ? (
              <StatusBadge label="Blocked" tone="orange" />
            ) : null}
          </div>
          <h2 className="mt-2 text-xl font-bold text-[var(--foreground)]">
            {title}
          </h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Queued {formatCreated(review.createdAt)}
            {phase2.generation?.generationStatus
              ? ` · Forge ${phase2.generation.generationStatus}`
              : ""}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {onAiReview ? (
            <Button
              variant="secondary"
              className="h-10"
              disabled={busy || aiBusy}
              onClick={onAiReview}
              title="Grade this listing against the proven Etsy playbook"
            >
              {aiBusy ? "AI reviewing…" : "AI review"}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            className="factory-control factory-control-reject h-10"
            disabled={busy}
            onClick={onReject}
          >
            Reject
          </Button>
          <Button
            variant={approveUi.tone === "blocked" ? "ghost" : "primary"}
            className={`factory-control h-10 ${
              approveUi.tone === "caution"
                ? "factory-control-approve-caution"
                : approveUi.tone === "blocked"
                  ? "factory-control-approve-blocked"
                  : "factory-control-approve"
            }`}
            disabled={approveDisabled}
            aria-disabled={approveDisabled}
            title={approveUi.disabledReason ?? undefined}
            onClick={() => {
              if (approveDisabled) return;
              onApprove();
            }}
          >
            {busy ? "Processing…" : approveUi.label}
          </Button>
        </div>
      </header>

      {approveUi.cautionMessage ? (
        <div
          className="mt-4 rounded-md border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
          role="status"
        >
          {approveUi.cautionMessage}
        </div>
      ) : null}

      {aiResult ? <AiVerdictPanel result={aiResult} /> : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-[12rem_1fr]">
        <div className="space-y-3">
          <div className="mockup-placeholder" aria-label="Listing mockup">
            {listing.mockupUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={listing.mockupUrl}
                alt=""
                className="h-full w-full rounded-md object-cover"
              />
            ) : (
              <>
                <span className="mockup-placeholder-icon" aria-hidden>
                  ◫
                </span>
                <span className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                  Mockup pending
                </span>
              </>
            )}
          </div>
        </div>

        <dl className="review-meta-grid">
          <Meta label="Niche" value={niche} />
          <Meta
            label="Trend score"
            value={
              <span className="font-mono text-[var(--accent-blue)]">
                {trendScore.toFixed(0)}
              </span>
            }
          />
          <Meta label="Price" value={`$${Number(listing.price ?? 0).toFixed(2)}`} />
          <Meta
            label="Listing status"
            value={getStatusLabel(listing.status)}
          />
          <Meta label="Platform" value={listing.platform} className="sm:col-span-2" />
          <Meta label="Description" value={description} className="lg:col-span-2" />
          <Meta
            label="SEO keywords"
            value={
              keywords.length > 0 ? (
                <ul className="flex flex-wrap gap-1.5">
                  {keywords.map((kw) => (
                    <li
                      key={kw}
                      className="rounded border border-[var(--border-dim)] bg-black/20 px-2 py-0.5 text-xs"
                    >
                      {kw}
                    </li>
                  ))}
                </ul>
              ) : (
                "—"
              )
            }
            className="lg:col-span-2"
          />
        </dl>
      </div>

      <ReviewPhase2Section
        phase2={phase2}
        idea={idea}
        onGenerationChange={onGenerationChange}
      />
    </article>
  );
}

const VERDICT_UI: Record<
  AiReviewResult["verdict"],
  { label: string; tone: "blue" | "warning" | "orange"; blurb: string }
> = {
  approve: {
    label: "AI verdict · Approve",
    tone: "blue",
    blurb: "Clears the proven Etsy bar — strong enough to ship.",
  },
  revise: {
    label: "AI verdict · Revise",
    tone: "warning",
    blurb: "Fixable — apply the fixes below, then it's ready.",
  },
  reject: {
    label: "AI verdict · Reject",
    tone: "orange",
    blurb: "Below the bar or non-compliant — send back to the agents.",
  },
};

const SUBSCORE_LABELS: Array<{ key: keyof AiReviewResult["subscores"]; label: string }> = [
  { key: "seo", label: "SEO" },
  { key: "sellability", label: "Sellability" },
  { key: "brand", label: "Brand" },
  { key: "quality", label: "Quality" },
  { key: "compliance", label: "Compliance" },
];

function AiVerdictPanel({ result }: { result: AiReviewResult }) {
  const ui = VERDICT_UI[result.verdict];
  return (
    <div className="mt-4 rounded-lg border border-[var(--border-dim)] bg-black/25 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <StatusBadge label={ui.label} tone={ui.tone} />
          {result.acted ? (
            <StatusBadge
              label={`Auto-${result.acted}`}
              tone={result.acted === "approved" ? "blue" : "orange"}
            />
          ) : null}
        </div>
        <span className="font-mono text-lg font-bold text-[var(--foreground)]">
          {result.overallScore}
          <span className="text-xs text-[var(--text-muted)]">/100</span>
        </span>
      </div>

      <p className="mt-2 text-xs text-[var(--text-muted)]">{ui.blurb}</p>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {SUBSCORE_LABELS.map(({ key, label }) => {
          const score = result.subscores[key];
          const bar = score >= 78 ? "bg-emerald-400" : score >= 55 ? "bg-amber-400" : "bg-red-400";
          return (
            <div key={key}>
              <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                <span>{label}</span>
                <span className="font-mono">{score}</span>
              </div>
              <div className="mt-1 h-1.5 w-full rounded-full bg-white/10">
                <div
                  className={`h-1.5 rounded-full ${bar}`}
                  style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {result.reasons.length > 0 ? (
        <div className="mt-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
            Why
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-[var(--foreground)]">
            {result.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {result.fixes.length > 0 ? (
        <div className="mt-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--accent-blue)]">
            Fixes to ship it
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-[var(--foreground)]">
            {result.fixes.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="mt-3 font-mono text-[10px] text-[var(--text-muted)]">
        Graded by {result.model} against the Etsy playbook
      </p>
    </div>
  );
}

function Meta({
  label,
  value,
  className = "",
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-[var(--foreground)]">{value}</dd>
    </div>
  );
}
