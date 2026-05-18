import type { ProductIdea } from "@/lib/ajax/types";
import type { ProductGeneration } from "@/lib/product/domain";

function pushTag(tags: Set<string>, value: unknown) {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (trimmed) tags.add(trimmed);
}

function pushTagList(tags: Set<string>, value: unknown) {
  if (!Array.isArray(value)) return;
  for (const item of value) pushTag(tags, item);
}

/** Tags from Nova keywords, Forge seoTags on idea payload, or generation metadata. */
export function collectStoreTags(
  idea: ProductIdea | null,
  generation: ProductGeneration | null,
): string[] {
  const tags = new Set<string>();

  for (const keyword of idea?.seoKeywords ?? []) {
    pushTag(tags, keyword);
  }

  if (idea?.rawPayload) {
    pushTagList(tags, idea.rawPayload.seoTags);
    pushTagList(tags, idea.rawPayload.tags);
  }

  const meta = generation?.structure.metadata;
  if (meta) {
    pushTagList(tags, meta.tags);
    pushTagList(tags, meta.seoTags);
  }

  return [...tags];
}
