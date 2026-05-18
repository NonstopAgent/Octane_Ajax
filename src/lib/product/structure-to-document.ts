import type { ProductStructure } from "@/lib/product/domain";
import type {
  ProductDocument,
  ProductField,
  ProductFieldType,
  ProductPage,
  ProductPageKind,
  ProductSection,
} from "@/lib/product/types";

function mapFieldType(fieldType: string): ProductFieldType {
  if (fieldType === "notes") return "textarea";
  if (
    fieldType === "text" ||
    fieldType === "textarea" ||
    fieldType === "checkbox" ||
    fieldType === "number" ||
    fieldType === "date"
  ) {
    return fieldType;
  }
  return "text";
}

function inferPageKind(
  page: ProductStructure["pages"][number],
  index: number,
  total: number,
): ProductPageKind {
  const metaKind = page.metadata?.pageKind;
  if (
    metaKind === "cover" ||
    metaKind === "intro" ||
    metaKind === "worksheet" ||
    metaKind === "summary" ||
    metaKind === "content"
  ) {
    return metaKind;
  }

  const haystack = `${page.title} ${page.purpose}`.toLowerCase();
  if (index === 0 && /cover|title\s*page|front/.test(haystack)) return "cover";
  if (
    /how\s*to|instruction|getting\s*started|overview|orient/.test(haystack)
  ) {
    return "intro";
  }
  if (
    index === total - 1 &&
    /summary|review|reflection|wrap[- ]?up|next\s*steps/.test(haystack)
  ) {
    return "summary";
  }
  if (index === 0 && total <= 3) return "content";
  if (index === 0) return "cover";
  if (index === 1 && total >= 4) return "intro";
  if (index === total - 1 && total >= 4) return "summary";
  return "worksheet";
}

function sectionFromForgeSection(
  section: ProductStructure["pages"][number]["sections"][number],
  page: ProductStructure["pages"][number],
): ProductSection {
  const fields: ProductField[] =
    section.fields?.map((field) => ({
      id: field.id,
      label: field.label,
      type: mapFieldType(field.fieldType),
      placeholder: field.placeholder,
    })) ?? [];

  const tableRaw = section.table;
  const checklistRaw = section.checklist;

  const productSection: ProductSection = {
    id: section.id,
    title: section.heading,
    description: section.body?.trim(),
    fields,
  };

  if (tableRaw && tableRaw.headers.length >= 2) {
    const rowCount = Math.max(3, tableRaw.rowCount ?? 6);
    productSection.table = {
      id: tableRaw.id ?? `${section.id}_table`,
      headers: tableRaw.headers,
      rows: Array.from({ length: rowCount }, () =>
        tableRaw.headers.map(() => ""),
      ),
    };
  }

  if (checklistRaw && checklistRaw.items.length > 0) {
    productSection.checklist = {
      id: checklistRaw.id ?? `${section.id}_checklist`,
      title: checklistRaw.title,
      items: checklistRaw.items,
    };
  }

  if (
    fields.length === 0 &&
    !productSection.table &&
    !productSection.checklist
  ) {
    const checkboxFields = fields.length;
    if (checkboxFields === 0) {
      productSection.linedLines = 8;
      productSection.fields = [
        {
          id: `${section.id}-notes`,
          label: section.heading,
          type: "textarea",
          placeholder: page.userInstructions ?? page.purpose,
        },
      ];
    }
  }

  return productSection;
}

function mapStructurePage(
  page: ProductStructure["pages"][number],
  index: number,
  total: number,
): ProductPage {
  const kind = inferPageKind(page, index, total);
  const sections = page.sections.map((section) =>
    sectionFromForgeSection(section, page),
  );

  return {
    id: `page-${page.pageNumber}`,
    kind,
    title: page.title,
    purpose: page.purpose,
    userInstructions: page.userInstructions,
    sections,
  };
}

/** Map Forge `ProductStructure` into the printable `ProductDocument` schema. */
export function productStructureToDocument(
  structure: ProductStructure,
  options: {
    title: string;
    subtitle?: string;
    audience?: string;
    disclosureNote?: string;
    footerNote?: string;
    footerLine?: string;
  },
): ProductDocument {
  const pages = structure.pages.map((page, index) =>
    mapStructurePage(page, index, structure.pages.length),
  );

  const disclosure =
    options.disclosureNote?.trim() ??
    options.footerNote?.trim() ??
    (typeof structure.metadata?.aiDisclosure === "string"
      ? structure.metadata.aiDisclosure
      : undefined);

  return {
    title: options.title.trim(),
    subtitle: options.subtitle?.trim(),
    format: structure.format,
    audience: options.audience,
    disclosureNote: disclosure,
    footerNote: disclosure,
    footerLine:
      options.footerLine?.trim() ??
      (structure.format ? `${structure.format} printable` : undefined),
    pages:
      pages.length > 0
        ? pages
        : [
            {
              id: "page-1",
              kind: "content",
              title: options.title,
              sections: [
                {
                  id: "default",
                  fields: [
                    {
                      id: "notes",
                      label: "Notes",
                      type: "textarea",
                    },
                  ],
                },
              ],
            },
          ],
  };
}

/** True when structure meets sellable page-count guidance (6+ pages). */
export function isSellableStructure(structure: ProductStructure): boolean {
  return structure.pages.length >= 6;
}
