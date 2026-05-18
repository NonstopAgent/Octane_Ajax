import type { ProductStructure } from "@/lib/product/domain";
import type { ProductDocument, ProductField, ProductFieldType } from "@/lib/product/types";

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

/** Map Forge `ProductStructure` into the printable `ProductDocument` schema. */
export function productStructureToDocument(
  structure: ProductStructure,
  options: {
    title: string;
    subtitle?: string;
    audience?: string;
    footerNote?: string;
  },
): ProductDocument {
  return {
    title: options.title.trim(),
    subtitle: options.subtitle?.trim(),
    format: structure.format,
    audience: options.audience,
    footerNote: options.footerNote,
    pages: structure.pages.map((page) => ({
      id: `page-${page.pageNumber}`,
      title: page.title,
      sections: page.sections.map((section) => {
        const fields: ProductField[] =
          section.fields?.map((field) => ({
            id: field.id,
            label: field.label,
            type: mapFieldType(field.fieldType),
            placeholder: field.placeholder,
          })) ?? [];

        if (fields.length === 0) {
          fields.push({
            id: `${section.id}-notes`,
            label: section.heading,
            type: "textarea",
            placeholder: page.userInstructions ?? page.purpose,
          });
        }

        return {
          id: section.id,
          title: section.heading,
          description: [section.body, page.purpose, page.userInstructions]
            .filter(Boolean)
            .join(" — "),
          fields,
        };
      }),
    })),
  };
}
