import Link from "next/link";
import { formatStorePrice } from "@/lib/store/display";
import type { PublicStoreListing } from "@/lib/store/public-queries";

type PublicStoreCatalogProps = {
  listings: PublicStoreListing[];
  configReady: boolean;
};

export function PublicStoreCatalog({
  listings,
  configReady,
}: PublicStoreCatalogProps) {
  if (!configReady) {
    return (
      <StoreShell>
        <Callout
          title="Store unavailable"
          body="Catalog requires Supabase configuration in .env.local."
        />
      </StoreShell>
    );
  }

  return (
    <StoreShell>
      <header className="border-b border-[var(--border-dim)] pb-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-[var(--accent-orange)]">
          Octane Ajax
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          Niche gifts, made to order
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--text-muted)]">
          Original print-on-demand mugs, art prints, and apparel from the
          Octane Ajax factory. Checkout is handled externally — no account
          required to browse.
        </p>
        <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
          SYS.AJAX.STORE :: PUBLIC CATALOG
        </p>
      </header>

      {listings.length === 0 ? (
        <Callout
          title="Nothing published yet"
          body="When an operator adds a Gumroad link and publishes a listing, it will appear here."
          className="mt-10"
        />
      ) : (
        <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {listings.map((item) => (
            <li key={item.id}>
              <PublicListingCard item={item} />
            </li>
          ))}
        </ul>
      )}

      <footer className="mt-12 border-t border-[var(--border-dim)] pt-6 text-center text-xs text-[var(--text-muted)]">
        <Link href="/" className="text-[var(--accent-blue)] hover:underline">
          ← Octane Ajax home
        </Link>
        {" · "}
        <Link
          href="/login?next=/factory"
          className="text-[var(--accent-blue)] hover:underline"
        >
          Operator sign-in
        </Link>
      </footer>
    </StoreShell>
  );
}

function StoreShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="factory-grid-bg min-h-full">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">{children}</div>
    </div>
  );
}

function Callout({
  title,
  body,
  className = "",
}: {
  title: string;
  body: string;
  className?: string;
}) {
  return (
    <div
      className={`factory-panel panel-glow-orange max-w-xl ${className}`.trim()}
    >
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-[var(--text-muted)]">{body}</p>
    </div>
  );
}

function PublicListingCard({ item }: { item: PublicStoreListing }) {
  const title = item.title ?? "Untitled product";
  const description =
    item.description ?? "Original print-on-demand gift from Octane Ajax.";

  return (
    <article className="factory-panel panel-glow-blue flex h-full flex-col">
      <header className="flex items-start justify-between gap-3 border-b border-[var(--border-dim)] pb-4">
        <h2 className="text-lg font-bold text-[var(--foreground)]">{title}</h2>
        <p className="shrink-0 font-mono text-lg font-bold text-[var(--accent-orange)]">
          {formatStorePrice(item.price)}
        </p>
      </header>

      <p className="mt-4 line-clamp-4 flex-1 text-sm text-[var(--text-muted)]">
        {description}
      </p>

      {item.tags.length > 0 ? (
        <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Tags">
          {item.tags.slice(0, 6).map((tag) => (
            <li key={tag}>
              <span className="rounded border border-[var(--border-dim)] bg-black/20 px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                {tag}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <footer className="mt-6 border-t border-[var(--border-dim)] pt-4">
        {item.gumroadUrl ? (
          <a
            href={item.gumroadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="factory-control factory-control-approve inline-flex h-10 w-full items-center justify-center text-sm font-semibold"
          >
            Buy on Gumroad
          </a>
        ) : (
          <button
            type="button"
            disabled
            className="factory-control inline-flex h-10 w-full cursor-not-allowed items-center justify-center text-sm font-semibold opacity-50"
            title="Checkout link not configured yet"
          >
            Coming soon
          </button>
        )}
        <p className="mt-2 text-center text-[10px] text-[var(--text-muted)]">
          {item.gumroadUrl
            ? "Opens Gumroad in a new tab"
            : "Published without Gumroad URL — buy disabled until operator adds link"}
        </p>
      </footer>
    </article>
  );
}
