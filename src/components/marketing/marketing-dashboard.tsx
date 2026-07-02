import Link from "next/link";
import { CopyField } from "@/components/marketing/copy-field";
import { CommandHeader } from "@/components/layout/command-header";
import { ButtonLink } from "@/components/ui/button";
import type { MarketingContentJob } from "@/lib/ajax/pixel/queries";

type MarketingDashboardProps = {
  jobs: MarketingContentJob[];
  isAuthenticated: boolean;
  configReady: boolean;
};

function formatHashtags(tags: string[]): string {
  return tags.join(" ");
}

type PromoMeta = NonNullable<MarketingContentJob["metadata"]>;

/** Instagram/TikTok-ready post: caption + hashtags, link stays in bio. */
function buildShortPost(meta: PromoMeta): string {
  const tagLine = formatHashtags(meta.hashtags);
  const caption = meta.shortCaption.includes("#")
    ? meta.shortCaption
    : `${meta.shortCaption}\n\n${tagLine}`;
  return caption;
}

/** Facebook/long-form post: long caption with the trackable link guaranteed. */
function buildLongPost(meta: PromoMeta): string {
  const link = meta.productUrl?.trim();
  const base =
    link && !meta.longCaption.includes(link)
      ? `${meta.longCaption}\n\nShop it here 👉 ${link}`
      : meta.longCaption;
  const tagLine = formatHashtags(meta.hashtags);
  return base.includes("#") ? base : `${base}\n\n${tagLine}`;
}

export function MarketingDashboard({
  jobs,
  isAuthenticated,
  configReady,
}: MarketingDashboardProps) {
  if (!configReady) {
    return (
      <Callout
        title="Supabase not configured"
        body="Add Supabase env vars to .env.local to view Pixel marketing copy."
      />
    );
  }

  if (!isAuthenticated) {
    return (
      <Callout
        title="Sign in required"
        body="Marketing copy is private to your account. Sign in to view scheduled promo packages."
        href="/login?next=/marketing"
        hrefLabel="Sign in"
      />
    );
  }

  const withMetadata = jobs.filter((j) => j.metadata != null);

  return (
    <div className="space-y-6">
      <CommandHeader
        badge="Pixel output"
        badgeTone="blue"
        title="Marketing"
        description="Ready-to-paste social posts generated when Pixel schedules content. Every link uses the Share & Save trackable URL, so orders from these posts earn reduced Etsy fees."
        aside={
          <ButtonLink href="/factory" variant="secondary">
            Factory floor
          </ButtonLink>
        }
        sysline="SYS.AJAX.MEDIA :: PIXEL"
      />

      <div className="factory-panel border-[var(--border-dim)] px-4 py-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--accent-blue)]">
          Scheduled promos
        </p>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {withMetadata.length} job{withMetadata.length === 1 ? "" : "s"} with
          marketing metadata
        </p>
      </div>

      {withMetadata.length === 0 ? (
        <div className="factory-panel panel-glow-blue text-center">
          <p className="text-lg font-semibold">No marketing copy yet</p>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Approve a listing at the Review Gate, then run Pixel from the Factory
            to generate promo packages.
          </p>
          <ButtonLink href="/review" variant="primary" className="mt-6">
            Review Gate
          </ButtonLink>
        </div>
      ) : (
        <ul className="space-y-6">
          {withMetadata.map((job) => {
            const meta = job.metadata!;
            return (
              <li
                key={job.id}
                className="factory-panel panel-glow-blue space-y-4 p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border-dim)] pb-4">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
                      {job.platform} · {job.status}
                    </p>
                    <h2 className="mt-1 text-lg font-semibold text-[var(--foreground)]">
                      {job.listingTitle ?? "Untitled listing"}
                    </h2>
                    {job.scheduledFor && (
                      <p className="mt-1 text-xs text-[var(--text-muted)]">
                        Scheduled{" "}
                        {new Date(job.scheduledFor).toLocaleString()}
                      </p>
                    )}
                  </div>
                  {meta.productUrl ? (
                    <a
                      href={meta.productUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-medium text-[var(--accent-blue)] hover:underline"
                    >
                      Open on Etsy →
                    </a>
                  ) : (
                    <Link
                      href={`/operator-store/${job.listingId}`}
                      className="text-sm font-medium text-[var(--accent-blue)] hover:underline"
                    >
                      View listing →
                    </Link>
                  )}
                </div>

                {meta.productUrl && (
                  <CopyField
                    label="Share & Save link (reduced Etsy fees)"
                    value={meta.productUrl}
                  />
                )}
                <CopyField
                  label="Instagram / TikTok caption (put the link in bio)"
                  value={buildShortPost(meta)}
                  multiline
                />
                <CopyField
                  label="Facebook / long-form post (link included)"
                  value={buildLongPost(meta)}
                  multiline
                />
                <CopyField
                  label="Pinterest title"
                  value={meta.pinterestTitle}
                />
                <CopyField
                  label="Pinterest description"
                  value={meta.pinterestDescription}
                  multiline
                />
                <div className="space-y-2">
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--accent-blue)]">
                    TikTok hook ideas
                  </p>
                  <ul className="space-y-2">
                    {meta.tiktokHookIdeas.map((hook, i) => (
                      <li key={`${job.id}-hook-${i}`}>
                        <CopyField label={`Hook ${i + 1}`} value={hook} />
                      </li>
                    ))}
                  </ul>
                </div>
                <CopyField
                  label="Hashtags"
                  value={formatHashtags(meta.hashtags)}
                />
              </li>
            );
          })}
        </ul>
      )}
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
    <div className="factory-panel panel-glow-blue mx-auto max-w-lg text-center">
      <p className="text-lg font-semibold">{title}</p>
      <p className="mt-2 text-sm text-[var(--text-muted)]">{body}</p>
      {href && hrefLabel && (
        <ButtonLink href={href} variant="primary" className="mt-6">
          {hrefLabel}
        </ButtonLink>
      )}
    </div>
  );
}
