import {
  reviewQcPanel,
  reviewStructureJson,
} from "@/components/review/review-panel-styles";
import type { ProductStructure } from "@/lib/product/domain";

type ReviewStructurePreviewProps = {
  structure: ProductStructure;
};

export function ReviewStructurePreview({
  structure,
}: ReviewStructurePreviewProps) {
  const hasPages = structure.pages.length > 0;

  return (
    <section
      className={reviewQcPanel}
      aria-labelledby="review-structure-heading"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p
          id="review-structure-heading"
          className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--accent-blue)]"
        >
          Product structure
        </p>
        <p className="font-mono text-xs text-[var(--text-muted)]">
          {structure.format} · {structure.pageCount} page
          {structure.pageCount === 1 ? "" : "s"}
        </p>
      </div>

      {hasPages ? (
        <ol className="mt-3 space-y-3">
          {structure.pages.map((page) => (
            <li
              key={`${page.pageNumber}-${page.title}`}
              className="rounded-md border border-[var(--border-dim)] bg-black/20 px-3 py-2"
            >
              <p className="text-sm font-semibold text-[var(--foreground)]">
                <span className="font-mono text-[var(--accent-blue)]">
                  p.{page.pageNumber}
                </span>{" "}
                {page.title}
              </p>
              {page.purpose ? (
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {page.purpose}
                </p>
              ) : null}
              {page.sections.length > 0 ? (
                <ul className="mt-2 space-y-1 border-t border-[var(--border-dim)] pt-2 text-xs text-[var(--foreground)]">
                  {page.sections.map((section) => (
                    <li key={section.id}>
                      <span className="font-medium">{section.heading}</span>
                      {section.body ? (
                        <span className="text-[var(--text-muted)]">
                          {" "}
                          — {section.body}
                        </span>
                      ) : null}
                      {section.fields && section.fields.length > 0 ? (
                        <span className="ml-1 text-[var(--text-muted)]">
                          ({section.fields.length} field
                          {section.fields.length === 1 ? "" : "s"})
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <pre className={reviewStructureJson}>
          {JSON.stringify(structure, null, 2)}
        </pre>
      )}
    </section>
  );
}
