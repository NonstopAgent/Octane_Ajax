"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { RejectModal } from "@/components/review/reject-modal";
import { ReviewCard, type AiReviewResult } from "@/components/review/review-card";
import { ReviewExternalLinksPanel } from "@/components/review/review-external-links-panel";
import type { ProductListing } from "@/lib/ajax/types";
import {
  ToastBanner,
  type ToastState,
  type ToastTone,
} from "@/components/factory/toast-banner";
import { hasComplianceRisk, resolveApproveApiError } from "@/lib/review/display";
import type { PendingReviewDetail } from "@/lib/review/types";
import type { GenerationStatus } from "@/lib/supabase/schema";
import { CommandHeader } from "@/components/layout/command-header";
import { REVIEW_GATE_MICROCOPY } from "@/lib/ajax/constants";
import { ButtonLink } from "@/components/ui/button";

type ReviewDashboardProps = {
  initialReviews: PendingReviewDetail[];
  publishReadyListings: ProductListing[];
  isAuthenticated: boolean;
  configReady: boolean;
};

export function ReviewDashboard({
  initialReviews,
  publishReadyListings: initialPublishReady,
  isAuthenticated,
  configReady,
}: ReviewDashboardProps) {
  const [reviews, setReviews] = useState(initialReviews);
  const [publishReady, setPublishReady] = useState(initialPublishReady);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<PendingReviewDetail | null>(
    null,
  );
  const [toast, setToast] = useState<ToastState>(null);
  const [approveErrors, setApproveErrors] = useState<Record<string, string>>(
    {},
  );
  const [aiResults, setAiResults] = useState<Record<string, AiReviewResult>>({});
  const [aiBusy, setAiBusy] = useState<string | null>(null);

  const showToast = useCallback((tone: ToastTone, message: string) => {
    setToast({ tone, message });
    window.setTimeout(() => setToast(null), 6000);
  }, []);

  const patchReviewGeneration = useCallback(
    (
      reviewId: string,
      patch: { generationStatus: GenerationStatus; storagePath?: string | null },
    ) => {
      setReviews((prev) =>
        prev.map((item) => {
          if (item.id !== reviewId || !item.phase2.generation) return item;
          return {
            ...item,
            phase2: {
              ...item.phase2,
              generation: {
                ...item.phase2.generation,
                generationStatus: patch.generationStatus,
                pdf: {
                  ...item.phase2.generation.pdf,
                  storagePath:
                    patch.storagePath !== undefined
                      ? patch.storagePath
                      : item.phase2.generation.pdf.storagePath,
                },
              },
            },
          };
        }),
      );
    },
    [],
  );

  const approve = async (reviewId: string) => {
    setActingOn(reviewId);
    setApproveErrors((prev) => {
      const next = { ...prev };
      delete next[reviewId];
      return next;
    });
    try {
      const res = await fetch("/api/ajax/review/approve", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        listing?: ProductListing;
      };

      if (!res.ok) {
        const message = resolveApproveApiError(res.status, data);
        setApproveErrors((prev) => ({ ...prev, [reviewId]: message }));
        showToast("error", message);
        return;
      }

      showToast("success", data.message ?? "Listing approved.");
      setReviews((prev) => prev.filter((r) => r.id !== reviewId));
      const approvedListing = data.listing as ProductListing | undefined;
      if (approvedListing) {
        setPublishReady((prev) => {
          const without = prev.filter((l) => l.id !== approvedListing.id);
          if (approvedListing.gumroadUrl) return without;
          return [
            { ...approvedListing, status: approvedListing.status ?? "approved" },
            ...without,
          ];
        });
      }
    } catch {
      showToast("error", "Network error during approval.");
    } finally {
      setActingOn(null);
    }
  };

  const runAiReview = async (reviewId: string) => {
    setAiBusy(reviewId);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 58000);
    try {
      const res = await fetch("/api/ajax/review/ai-review", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        // autonomous: this button should clear the gate, not just show an opinion.
        body: JSON.stringify({ reviewId, autonomous: true }),
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => ({}))) as
        | (AiReviewResult & { ok: true })
        | { ok?: false; error?: string };

      if (!res.ok || !("ok" in data) || data.ok !== true) {
        const message =
          ("error" in data && data.error) || "AI review failed.";
        showToast("error", message);
        return;
      }

      const result = data as AiReviewResult;
      setAiResults((prev) => ({ ...prev, [reviewId]: result }));

      if (result.acted === "approved") {
        showToast(
          "success",
          `AI cleared it · ${result.overallScore}/100. Etsy draft created.`,
        );
        setReviews((prev) => prev.filter((r) => r.id !== reviewId));
      } else if (result.acted === "rejected") {
        showToast(
          "error",
          `AI rejected · ${result.overallScore}/100. Sent back to the agents.`,
        );
        setReviews((prev) => prev.filter((r) => r.id !== reviewId));
      } else {
        const tone =
          result.verdict === "approve"
            ? "success"
            : result.verdict === "reject"
              ? "error"
              : "info";
        showToast(
          tone,
          `AI verdict: ${result.verdict} · ${result.overallScore}/100.`,
        );
      }
    } catch (err) {
      showToast(
        "error",
        err instanceof Error && err.name === "AbortError"
          ? "AI review timed out — please try again."
          : "Network error during AI review.",
      );
    } finally {
      window.clearTimeout(timer);
      setAiBusy(null);
    }
  };

  const confirmReject = async (reason: string) => {
    if (!rejectTarget) return;
    const reviewId = rejectTarget.id;
    setActingOn(reviewId);

    try {
      const res = await fetch("/api/ajax/review/reject", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewId, reason }),
      });
      const data = await res.json();

      if (!res.ok) {
        showToast("error", data.error ?? "Rejection failed.");
        return;
      }

      showToast("success", data.message ?? "Listing rejected.");
      setRejectTarget(null);
      setReviews((prev) => prev.filter((r) => r.id !== reviewId));
    } catch {
      showToast("error", "Network error during rejection.");
    } finally {
      setActingOn(null);
    }
  };

  if (!configReady) {
    return (
      <Callout
        title="Supabase not configured"
        body="Add Supabase env vars to .env.local to use the Review Gate."
      />
    );
  }

  if (!isAuthenticated) {
    return (
      <Callout
        title="Sign in required"
        body="Sign in to approve or reject listings at the Review Gate."
        href="/login?next=/review"
        hrefLabel="Sign in"
      />
    );
  }

  return (
    <div className="space-y-6">
      <CommandHeader
        badge="Quality control"
        badgeTone="warning"
        title="Review Gate"
        description={`${REVIEW_GATE_MICROCOPY} — approving creates an Etsy draft and generates marketing in the background (Etsy must be connected). Reject with feedback for agent memory.`}
        aside={
          <ButtonLink href="/factory" variant="secondary">
            Back to factory
          </ButtonLink>
        }
        sysline="SYS.AJAX.QC :: HUMAN LOOP"
      />

      <ToastBanner toast={toast} />

      {reviews.length > 0 && (
        <div className="qc-station-banner">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--accent-orange)]">
            Inspection queue
          </p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {reviews.length} unit{reviews.length === 1 ? "" : "s"} awaiting
            operator sign-off.
            {countPhase2Alerts(reviews) > 0
              ? ` · ${countPhase2Alerts(reviews)} with brain caution or compliance signals`
              : ""}
          </p>
        </div>
      )}

      {reviews.length === 0 ? (
        <div className="factory-panel panel-glow-blue text-center">
          <p className="text-lg font-semibold">Review queue clear</p>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Run an Ajax cycle on the factory floor to generate a listing for
            review.
          </p>
          <ButtonLink href="/factory" variant="primary" className="mt-6">
            Open factory floor
          </ButtonLink>
        </div>
      ) : (
        <ul className="space-y-6">
          {reviews.map((review) => (
            <li key={review.id}>
              <ReviewCard
                review={review}
                busy={actingOn === review.id}
                approveError={approveErrors[review.id] ?? null}
                aiResult={aiResults[review.id] ?? null}
                aiBusy={aiBusy === review.id}
                onAiReview={() => runAiReview(review.id)}
                onApprove={() => approve(review.id)}
                onReject={() => setRejectTarget(review)}
                onGenerationChange={(patch) =>
                  patchReviewGeneration(review.id, patch)
                }
              />
            </li>
          ))}
        </ul>
      )}

      <ReviewExternalLinksPanel
        listings={publishReady}
        onPublished={(listingId) =>
          setPublishReady((prev) => prev.filter((l) => l.id !== listingId))
        }
      />

      <RejectModal
        open={Boolean(rejectTarget)}
        productTitle={
          rejectTarget?.listing.title ??
          rejectTarget?.idea?.title ??
          "this product"
        }
        loading={actingOn !== null && rejectTarget?.id === actingOn}
        onClose={() => {
          if (actingOn) return;
          setRejectTarget(null);
        }}
        onConfirm={confirmReject}
      />
    </div>
  );
}

function countPhase2Alerts(reviews: PendingReviewDetail[]): number {
  return reviews.filter((review) => {
    const verdict = review.phase2.brain?.verdict;
    if (verdict === "blocked" || verdict === "needs_revision") return true;
    const generation = review.phase2.generation;
    if (!generation) return false;
    return hasComplianceRisk({
      warnings: generation.complianceWarnings,
      flags: generation.complianceFlags,
    });
  }).length;
}

function Callout({
  title,
  body,
  href,
  hrefLabel,
}: {
  title: string;
  body: string;
  href?: string;
  hrefLabel?: string;
}) {
  return (
    <div className="factory-panel panel-glow-orange max-w-xl">
      <h1 className="text-xl font-bold">{title}</h1>
      <p className="mt-2 text-sm text-[var(--text-muted)]">{body}</p>
      {href && hrefLabel && (
        <Link
          href={href}
          className="mt-4 inline-flex text-sm font-semibold text-[var(--accent-blue)] hover:underline"
        >
          {hrefLabel} →
        </Link>
      )}
    </div>
  );
}
