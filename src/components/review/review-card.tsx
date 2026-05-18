"use client";

import { useCallback, useState, type ReactNode } from "react";
import { ReviewPhase2Section } from "@/components/review/review-phase2-section";
import { getStatusLabel } from "@/lib/ajax/status";
import { buildSellabilityInputFromGeneration } from "@/lib/review/approval-guards";
import {
  buildProductPdfGenerateHref,
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

type ReviewCardProps = {
  review: PendingReviewDetail;
  busy: boolean;
  approveError?: string | null;
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
  const generationId = phase2.generation?.id ?? null;
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfActionError, setPdfActionError] = useState<string | null>(null);

  const applyGenerationPatch = useCallback(
    (patch: {
      generationStatus: GenerationStatus;
      storagePath?: string | null;
    }) => {
      onGenerationChange?.(patch);
    },
    [onGenerationChange],
  );

  const generatePdf = async () => {
    if (!generationId || sellabilityInput.mockMode) return;

    setPdfBusy(true);
    setPdfActionError(null);
    applyGenerationPatch({ generationStatus: "generating" });

    try {
      const res = await fetch(buildProductPdfGenerateHref(generationId), {
        method: "POST",
        credentials: "include",
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        status?: GenerationStatus;
        storagePath?: string;
      };

      if (!res.ok) {
        const nextStatus =
          data.status === "generating" ? "generating" : "failed";
        applyGenerationPatch({ generationStatus: nextStatus });
        setPdfActionError(
          data.error ??
            "PDF generation failed. Request failed or timed out. Check Vercel logs.",
        );
        return;
      }

      applyGenerationPatch({
        generationStatus: data.status ?? "ready",
        storagePath: data.storagePath ?? phase2.generation?.pdf.storagePath,
      });
    } catch {
      applyGenerationPatch({ generationStatus: "failed" });
      setPdfActionError("Request failed or timed out. Check Vercel logs.");
    } finally {
      setPdfBusy(false);
    }
  };

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
          {approveUi.showGeneratePdfAction && generationId ? (
            <div className="mt-3">
              <Button
                type="button"
                variant="secondary"
                className="h-9"
                disabled={pdfBusy || busy}
                onClick={() => void generatePdf()}
              >
                {pdfBusy ? "Generating…" : "Generate PDF"}
              </Button>
              {pdfActionError ? (
                <p className="mt-2 text-xs text-red-300" role="alert">
                  {pdfActionError}
                </p>
              ) : null}
            </div>
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
