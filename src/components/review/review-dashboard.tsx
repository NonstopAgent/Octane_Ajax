"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { RejectModal } from "@/components/review/reject-modal";
import { ReviewCard } from "@/components/review/review-card";
import {
  ToastBanner,
  type ToastState,
  type ToastTone,
} from "@/components/factory/toast-banner";
import type { PendingReviewDetail } from "@/lib/review/types";
import { CommandHeader } from "@/components/layout/command-header";
import { REVIEW_GATE_MICROCOPY } from "@/lib/ajax/constants";
import { ButtonLink } from "@/components/ui/button";

type ReviewDashboardProps = {
  initialReviews: PendingReviewDetail[];
  isAuthenticated: boolean;
  configReady: boolean;
};

export function ReviewDashboard({
  initialReviews,
  isAuthenticated,
  configReady,
}: ReviewDashboardProps) {
  const [reviews, setReviews] = useState(initialReviews);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<PendingReviewDetail | null>(
    null,
  );
  const [toast, setToast] = useState<ToastState>(null);

  const showToast = useCallback((tone: ToastTone, message: string) => {
    setToast({ tone, message });
    window.setTimeout(() => setToast(null), 6000);
  }, []);

  const approve = async (reviewId: string) => {
    setActingOn(reviewId);
    try {
      const res = await fetch("/api/ajax/review/approve", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewId }),
      });
      const data = await res.json();

      if (!res.ok) {
        showToast("error", data.error ?? "Approval failed.");
        return;
      }

      showToast("success", data.message ?? "Listing approved.");
      setReviews((prev) => prev.filter((r) => r.id !== reviewId));
    } catch {
      showToast("error", "Network error during approval.");
    } finally {
      setActingOn(null);
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
        description={`${REVIEW_GATE_MICROCOPY} — approve Forge listings to release Pixel, or reject with feedback for agent memory.`}
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
                onApprove={() => approve(review.id)}
                onReject={() => setRejectTarget(review)}
              />
            </li>
          ))}
        </ul>
      )}

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
