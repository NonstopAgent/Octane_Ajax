import Link from "next/link";
import { notFound } from "next/navigation";
import { StoreListingDetailView } from "@/components/store/store-listing-detail";
import { fetchStoreListingById } from "@/lib/store/queries";
import { createClient } from "@/lib/supabase/server";

type StoreListingPageProps = {
  params: Promise<{ listingId: string }>;
};

function configReady() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export default async function StoreListingPage({ params }: StoreListingPageProps) {
  const { listingId } = await params;
  const ready = configReady();

  if (!ready) {
    return (
      <div className="factory-panel panel-glow-orange max-w-xl">
        <h1 className="text-xl font-bold">Supabase not configured</h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Add Supabase env vars to .env.local to load storefront listings.
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="factory-panel panel-glow-orange max-w-xl">
        <h1 className="text-xl font-bold">Sign in required</h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          This storefront listing is private to your operator account.
        </p>
        <Link
          href={`/login?next=/store/${listingId}`}
          className="mt-4 inline-flex text-sm font-semibold text-[var(--accent-blue)] hover:underline"
        >
          Sign in →
        </Link>
      </div>
    );
  }

  let item: Awaited<ReturnType<typeof fetchStoreListingById>> = null;
  try {
    item = await fetchStoreListingById(supabase, user.id, listingId);
  } catch (err) {
    console.error("[store listing page] failed to load", err);
  }

  if (!item) {
    notFound();
  }

  return <StoreListingDetailView item={item} />;
}
