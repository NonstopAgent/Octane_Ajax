import Link from "next/link";
import { getStatusLabel } from "@/lib/ajax/status";
import {
  formatStorePrice,
  getStorePdfDownloadHref,
  pdfStatusLabel,
  pdfStatusTone,
} from "@/lib/store/display";
import { GumroadPublishAction } from "@/components/store/gumroad-publish-action";
import type { StoreListingDetail } from "@/lib/store/types";
import { StatusBadge } from "@/components/ui/status-badge";

type StoreListingCardProps = {
  item: StoreListingDetail;
};

function isSimulatedDemo(item: StoreListingDetail): boolean {
  return item.idea?.rawPayload?.simulated === true;
}

export function StoreListingCard({ item }: StoreListingCardProps) {
  const { listing, idea, brain, generation, tags, displayStatus } = item;
  const title = listing.title ?? idea?.title ?? "Untitled product";
  const niche = idea?.niche ?? "—";
  const description =
    listing.description ?? idea?.description ?? "No description provided.";
  const generationStatus = generation?.generationStatus ?? "pending";
  const downloadHref = getStorePdfDownloadHref({
    generationId: generation?.id ?? null,
    generationStatus,
    pdf: generation?.pdf ?? { storagePath: null, publicUrl: null },
    mockMode: isSimulatedDemo(item),
  });

  return (
    <article className="factory-panel flex h-full flex-col">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border-dim)] pb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge label={getStatusLabel(displayStatus)} tone="blue" />
            {brain ? (
              <StatusBadge
                label={`Brain ${brain.score.totalScore}`}
                tone="blue"
              />
            ) : null}
            <StatusBadge
              label={pdfStatusLabel(generationStatus)}
              tone={pdfStatusTone(generationStatus)}
            />
          </div>
          <h2 className="mt-2 text-lg font-bold text-[var(--foreground)]">
            <Link
              href={`/operator-store/${listing.id}`}
              className="hover:text-[var(--accent-blue)]"
            >
              {title}
            </Link>
          </h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">{niche}</p>
        </div>
        <p className="font-mono text-xl font-bold text-[var(--accent-orange)]">
          {formatStorePrice(listing.price)}
        </p>
      </header>

      <p className="mt-4 line-clamp-3 flex-1 text-sm text-[var(--text-muted)]">
        {description}
      </p>

      {tags.length > 0 ? (
        <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Tags">
          {tags.slice(0, 6).map((tag) => (
            <li key={tag}>
              <span className="rounded border border-[var(--border-dim)] bg-black/20 px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                {tag}
              </span>
            </li>
          ))}
          {tags.length > 6 ? (
            <li className="self-center text-[10px] text-[var(--text-muted)]">
              +{tags.length - 6}
            </li>
          ) : null}
        </ul>
      ) : null}

      <footer className="mt-6 space-y-4 border-t border-[var(--border-dim)] pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={`/operator-store/${listing.id}`}
            className="text-sm font-semibold text-[var(--accent-blue)] hover:underline"
          >
            View details
          </Link>
          {downloadHref ? (
            <a
              href={downloadHref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-[var(--text-muted)] hover:text-[var(--foreground)]"
            >
              Download PDF
            </a>
          ) : null}
        </div>
        <GumroadPublishAction
          listingId={listing.id}
          status={displayStatus}
          gumroadUrl={listing.gumroadUrl}
          gumroadProductId={listing.gumroadProductId}
        />
      </footer>
    </article>
  );
}
