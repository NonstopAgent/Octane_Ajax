import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { TABLES } from "@/lib/supabase/schema";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Pet Parent Gift Guides | Gotcha Day Goods",
  description:
    "Gift guides for rescue-pet parents — gotcha days, senior pets, memorials, and the humans who love them.",
};

type GuideRow = {
  slug: string;
  title: string;
  description: string | null;
  hero_image_url: string | null;
  created_at: string;
};

export default async function GuidesIndexPage() {
  let guides: GuideRow[] = [];
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from(TABLES.GUIDES)
      .select("slug, title, description, hero_image_url, created_at")
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .limit(50);
    guides = (data ?? []) as GuideRow[];
  } catch {
    guides = [];
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">
        Pet Parent Gift Guides
      </h1>
      <p className="mt-2 text-neutral-600">
        Thoughtful picks for gotcha days, senior pets, memorials, and the
        humans who rescued them — from the team behind{" "}
        <a
          className="underline"
          href="https://gotchadaygoods.etsy.com"
          rel="noopener"
          target="_blank"
        >
          Gotcha Day Goods
        </a>
        .
      </p>
      <div className="mt-10 space-y-8">
        {guides.length === 0 ? (
          <p className="text-neutral-500">First guides are on the way — check back soon.</p>
        ) : (
          guides.map((g) => (
            <Link
              key={g.slug}
              href={`/guides/${g.slug}`}
              className="block rounded-xl border border-neutral-200 p-5 transition hover:border-neutral-400"
            >
              <h2 className="text-xl font-medium">{g.title}</h2>
              {g.description ? (
                <p className="mt-1 text-sm text-neutral-600">{g.description}</p>
              ) : null}
              <p className="mt-2 text-xs uppercase tracking-wide text-neutral-400">
                {new Date(g.created_at).toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            </Link>
          ))
        )}
      </div>
    </main>
  );
}
