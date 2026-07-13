import Link from "next/link";
import { notFound } from "next/navigation";
import { renderGuideMarkdown } from "@/lib/affiliate/render-md";
import { createClient } from "@/lib/supabase/server";
import { TABLES } from "@/lib/supabase/schema";

export const dynamic = "force-dynamic";

type GuideRow = {
  slug: string;
  title: string;
  description: string | null;
  hero_image_url: string | null;
  content_md: string;
  created_at: string;
};

async function loadGuide(slug: string): Promise<GuideRow | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from(TABLES.GUIDES)
      .select("slug, title, description, hero_image_url, content_md, created_at")
      .eq("status", "published")
      .eq("slug", slug)
      .maybeSingle();
    return (data as GuideRow | null) ?? null;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const guide = await loadGuide(slug);
  if (!guide) return { title: "Guide not found" };
  return {
    title: `${guide.title} | Gotcha Day Goods Guides`,
    description: guide.description ?? undefined,
    openGraph: {
      title: guide.title,
      description: guide.description ?? undefined,
      images: guide.hero_image_url ? [guide.hero_image_url] : undefined,
      type: "article",
    },
  };
}

export default async function GuidePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const guide = await loadGuide(slug);
  if (!guide) notFound();

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <Link href="/guides" className="text-sm text-neutral-500 underline">
        ← All guides
      </Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">
        {guide.title}
      </h1>
      <p className="mt-2 text-xs uppercase tracking-wide text-neutral-400">
        {new Date(guide.created_at).toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        })}
      </p>
      {guide.hero_image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={guide.hero_image_url}
          alt={guide.title}
          className="mt-6 w-full rounded-xl object-cover"
        />
      ) : null}
      <article
        className="prose prose-neutral mt-8 max-w-none [&_a]:underline"
        dangerouslySetInnerHTML={{
          __html: renderGuideMarkdown(guide.content_md),
        }}
      />
      <div className="mt-12 rounded-xl border border-neutral-200 p-5">
        <p className="font-medium">Looking for something made for YOUR pet?</p>
        <p className="mt-1 text-sm text-neutral-600">
          Every item in our shop can be personalized with your pet&apos;s name.
        </p>
        <a
          className="mt-3 inline-block rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white"
          href="https://gotchadaygoods.etsy.com?utm_source=gotchaday_guides&utm_medium=guide_footer"
          rel="noopener"
          target="_blank"
        >
          Visit Gotcha Day Goods →
        </a>
      </div>
    </main>
  );
}
