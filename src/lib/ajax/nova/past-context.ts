import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";

export type NovaPastContext = {
  rejectedNiches: string[];
  approvedNiches: string[];
  recentTitles: string[];
};

type IdeaNicheRow = {
  niche: string | null;
  raw_payload: unknown;
};

type ListingWithIdea = {
  product_ideas: IdeaNicheRow | IdeaNicheRow[] | null;
};

/** Prefer `product_ideas.niche`; fall back to `raw_payload.niche`. */
export function extractNicheFromIdea(
  niche: string | null | undefined,
  rawPayload: unknown,
): string | null {
  const trimmed = niche?.trim();
  if (trimmed) return trimmed;

  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    return null;
  }

  const fromPayload = (rawPayload as Record<string, unknown>).niche;
  if (typeof fromPayload === "string" && fromPayload.trim()) {
    return fromPayload.trim();
  }

  return null;
}

function joinedIdea(
  row: ListingWithIdea,
): IdeaNicheRow | null {
  const idea = row.product_ideas;
  if (!idea) return null;
  return Array.isArray(idea) ? idea[0] ?? null : idea;
}

export function extractNichesFromListings(rows: ListingWithIdea[]): string[] {
  const niches: string[] = [];
  for (const row of rows) {
    const idea = joinedIdea(row);
    if (!idea) continue;
    const niche = extractNicheFromIdea(idea.niche, idea.raw_payload);
    if (niche) niches.push(niche);
  }
  return dedupePreserveOrder(niches);
}

export function dedupePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export function hasNovaPastContext(ctx: NovaPastContext): boolean {
  return (
    ctx.rejectedNiches.length > 0 ||
    ctx.approvedNiches.length > 0 ||
    ctx.recentTitles.length > 0
  );
}

export function buildNovaPastContext(
  rejectedRows: ListingWithIdea[],
  approvedRows: ListingWithIdea[],
  titleRows: { title: string | null }[],
): NovaPastContext | undefined {
  const pastContext: NovaPastContext = {
    rejectedNiches: extractNichesFromListings(rejectedRows),
    approvedNiches: extractNichesFromListings(approvedRows),
    recentTitles: dedupePreserveOrder(
      titleRows
        .map((row) => row.title?.trim())
        .filter((title): title is string => Boolean(title)),
    ),
  };

  return hasNovaPastContext(pastContext) ? pastContext : undefined;
}

const LISTING_IDEA_SELECT = `
  product_ideas (
    niche,
    raw_payload
  )
`;

export async function fetchNovaPastContext(
  supabase: Supabase,
  userId: string,
): Promise<NovaPastContext | undefined> {
  const [rejectedResult, approvedResult, titlesResult] = await Promise.all([
    supabase
      .from(TABLES.LISTINGS)
      .select(LISTING_IDEA_SELECT)
      .eq("user_id", userId)
      .eq("status", "rejected")
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from(TABLES.LISTINGS)
      .select(LISTING_IDEA_SELECT)
      .eq("user_id", userId)
      .in("status", ["approved", "published"])
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from(TABLES.IDEAS)
      .select("title")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  if (rejectedResult.error) {
    throw new Error(
      `Failed to load rejected listings for Nova memory: ${rejectedResult.error.message}`,
    );
  }
  if (approvedResult.error) {
    throw new Error(
      `Failed to load approved listings for Nova memory: ${approvedResult.error.message}`,
    );
  }
  if (titlesResult.error) {
    throw new Error(
      `Failed to load recent product ideas for Nova memory: ${titlesResult.error.message}`,
    );
  }

  return buildNovaPastContext(
    (rejectedResult.data ?? []) as ListingWithIdea[],
    (approvedResult.data ?? []) as ListingWithIdea[],
    titlesResult.data ?? [],
  );
}
