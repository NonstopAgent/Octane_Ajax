"use client";

import type { ReactNode } from "react";
import { ReviewPhase2Section } from "@/components/review/review-phase2-section";
import { getStatusLabel } from "@/lib/ajax/status";
import type { PendingReviewDetail } from "@/lib/review/types";
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
  onApprove: () => void;
  onReject: () => void;
};

export function ReviewCard({
  review,
  busy,
  onApprove,
  onReject,
}: ReviewCardProps) {
  const { listing, idea, phase2 } = review;
  const title = listing.title ?? idea?.title ?? "Untitled product";
  const description =
    listing.description ?? idea?.description ?? "No description provided.";
  const niche = idea?.niche ?? "—";
  const keywords = idea?.seoKeywords ?? [];
  const trendScore = idea?.trendScore ?? 0;

  return (
    <article className="review-card">
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
            {phase2.generation?.complianceWarnings?.length ||
            phase2.generation?.complianceFlags?.length ? (
              <StatusBadge label="Compliance flags" tone="orange" />
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
            variant="primary"
            className="factory-control factory-control-approve h-10"
            disabled={busy}
            onClick={onApprove}
          >
            {busy ? "Processing…" : "Approve"}
          </Button>
        </div>
      </header>

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

      <ReviewPhase2Section phase2={phase2} idea={idea} />
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
