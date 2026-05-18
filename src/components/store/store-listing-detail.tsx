import Link from "next/link";
import { ReviewPhase2Section } from "@/components/review/review-phase2-section";
import { getStatusLabel } from "@/lib/ajax/status";
import { formatStorePrice } from "@/lib/store/display";
import { GumroadPublishAction } from "@/components/store/gumroad-publish-action";
import type { StoreListingDetail } from "@/lib/store/types";
import { StatusBadge } from "@/components/ui/status-badge";
import { Panel } from "@/components/ui/panel";

type StoreListingDetailViewProps = {
  item: StoreListingDetail;
};

export function StoreListingDetailView({ item }: StoreListingDetailViewProps) {
  const { listing, idea, brain, generation, tags, displayStatus } = item;
  const title = listing.title ?? idea?.title ?? "Untitled product";
  const description =
    listing.description ?? idea?.description ?? "No description provided.";
  const niche = idea?.niche ?? "—";

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb">
        <Link
          href="/operator-store"
          className="text-sm font-medium text-[var(--accent-blue)] hover:underline"
        >
          ← Back to operator storefront
        </Link>
      </nav>

      <header className="factory-panel panel-glow-blue">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge label={getStatusLabel(displayStatus)} tone="blue" />
          {brain ? (
            <StatusBadge
              label={`Brain ${brain.score.totalScore}`}
              tone="blue"
            />
          ) : null}
        </div>
        <h1 className="mt-3 text-2xl font-bold text-[var(--foreground)]">
          {title}
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">{niche}</p>
        <p className="mt-4 font-mono text-3xl font-bold text-[var(--accent-orange)]">
          {formatStorePrice(listing.price)}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Panel title="Listing copy" glow="blue">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--foreground)]">
            {description}
          </p>
          {tags.length > 0 ? (
            <div className="mt-6">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
                Tags
              </p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <li key={tag}>
                    <span className="rounded border border-[var(--border-dim)] bg-black/20 px-2 py-0.5 text-xs text-[var(--text-muted)]">
                      {tag}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Panel>

        <ReviewPhase2Section
          phase2={{ brain, generation }}
          idea={idea}
        />
      </div>

      <Panel title="Gumroad checkout" glow="blue">
        <p className="mb-4 text-sm text-[var(--text-muted)]">
          Approved or published listings can be repaired by publishing the
          ready PDF to Gumroad from the server.
        </p>
        <GumroadPublishAction
          listingId={listing.id}
          status={displayStatus}
          gumroadUrl={listing.gumroadUrl}
          gumroadProductId={listing.gumroadProductId}
        />
      </Panel>
    </div>
  );
}
