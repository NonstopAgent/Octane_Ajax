import { z } from "zod";
import type { ProductStructure } from "@/lib/product/domain";
import type { NovaEvaluatedIdea } from "@/lib/ajax/nova/types";

export const FORGE_PROMPT_VERSION = "forge-generation-v2";

export const AI_DISCLOSURE_TEXT =
  "AI tools assisted in drafting and structuring this digital product. The seller reviewed and customized the final product.";

export const FORGE_MIN_PAGES = 6;
export const FORGE_MAX_PAGES = 12;

export type ForgeGenerationMode = "llm" | "fallback";

const ForgeFieldSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  fieldType: z.enum(["text", "checkbox", "number", "date", "notes"]),
  placeholder: z.string().optional(),
});

const ForgeTableSchema = z.object({
  id: z.string().min(1).optional(),
  headers: z.array(z.string().min(1)).min(2).max(6),
  rowCount: z.number().int().min(3).max(14).optional(),
});

const ForgeChecklistSchema = z.object({
  id: z.string().min(1).optional(),
  title: z.string().optional(),
  items: z.array(z.string().min(1)).min(2).max(24),
});

const ForgeSectionSchema = z
  .object({
    id: z.string().min(1),
    heading: z.string().min(1),
    body: z.string().optional(),
    fields: z.array(ForgeFieldSchema).optional(),
    table: ForgeTableSchema.optional(),
    checklist: ForgeChecklistSchema.optional(),
  })
  .superRefine((section, ctx) => {
    const hasFields = (section.fields?.length ?? 0) > 0;
    const hasTable = Boolean(section.table);
    const hasChecklist = Boolean(section.checklist);
    if (!hasFields && !hasTable && !hasChecklist) {
      ctx.addIssue({
        code: "custom",
        message:
          "Each section needs fields, a table, or a checklist for printable utility",
        path: ["fields"],
      });
    }
  });

const ForgePageKindSchema = z.enum([
  "cover",
  "instructions",
  "worksheet",
  "summary",
]);

const ForgePageSchema = z.object({
  pageNumber: z.number().int().positive(),
  pageKind: ForgePageKindSchema.optional(),
  title: z.string().min(1),
  purpose: z.string().min(1),
  userInstructions: z.string().min(1),
  sections: z.array(ForgeSectionSchema).min(1),
});

export const ForgeProductStructureSchema = z
  .object({
    format: z.string().min(1),
    pages: z.array(ForgePageSchema).min(FORGE_MIN_PAGES).max(FORGE_MAX_PAGES),
  })
  .superRefine((structure, ctx) => {
    const numbers = structure.pages.map((p) => p.pageNumber);
    const unique = new Set(numbers);
    if (unique.size !== numbers.length) {
      ctx.addIssue({
        code: "custom",
        message: "productStructure.pages must have unique pageNumber values",
        path: ["pages"],
      });
    }

    if (structure.pages.length < FORGE_MIN_PAGES) {
      ctx.addIssue({
        code: "custom",
        message: `Sellable printables need at least ${FORGE_MIN_PAGES} pages (got ${structure.pages.length})`,
        path: ["pages"],
      });
    }

    if (structure.pages.length <= 3) {
      ctx.addIssue({
        code: "custom",
        message:
          "Thin 2–3 page structures are not sellable — add cover, instructions, worksheets, and a summary page",
        path: ["pages"],
      });
    }

    const kinds = structure.pages.map(
      (p) => p.pageKind ?? inferForgePageKind(p, structure.pages.length),
    );
    const required: Array<z.infer<typeof ForgePageKindSchema>> = [
      "cover",
      "instructions",
      "worksheet",
      "summary",
    ];
    for (const kind of required) {
      if (!kinds.includes(kind)) {
        ctx.addIssue({
          code: "custom",
          message: `productStructure must include a ${kind} page`,
          path: ["pages"],
        });
      }
    }

    const worksheetCount = kinds.filter((k) => k === "worksheet").length;
    if (worksheetCount < 2) {
      ctx.addIssue({
        code: "custom",
        message: "Include at least two worksheet pages with fields, tables, or checklists",
        path: ["pages"],
      });
    }

    for (const page of structure.pages) {
      for (const section of page.sections) {
        if (!section.heading.trim()) {
          ctx.addIssue({
            code: "custom",
            message: "Each section requires a non-empty heading",
            path: ["pages"],
          });
        }
      }
    }
  });

function inferForgePageKind(
  page: z.infer<typeof ForgePageSchema>,
  total: number,
): z.infer<typeof ForgePageKindSchema> {
  const haystack = `${page.title} ${page.purpose}`.toLowerCase();
  if (/cover|title\s*page/.test(haystack)) return "cover";
  if (/how\s*to|instruction|getting\s*started/.test(haystack)) {
    return "instructions";
  }
  if (/summary|review|reflection|wrap/.test(haystack)) return "summary";
  if (page.pageNumber === 1) return "cover";
  if (page.pageNumber === 2 && total >= 4) return "instructions";
  if (page.pageNumber === total && total >= 4) return "summary";
  return "worksheet";
}

export type ForgeLlmProductStructure = z.infer<typeof ForgeProductStructureSchema>;

export const ForgeLlmResponseSchema = z.object({
  listingTitle: z.string().min(1),
  listingDescription: z.string().min(1),
  seoTags: z.array(z.string().min(1)).length(13),
  suggestedPrice: z.number().positive().max(99.99),
  productStructure: ForgeProductStructureSchema,
  complianceNotes: z.array(z.string()),
  aiDisclosure: z.string().min(1),
  coverImagePrompt: z.string().min(1),
  revisionNotes: z.array(z.string()),
});

export type ForgeLlmResponse = z.infer<typeof ForgeLlmResponseSchema>;

export type ForgeGenerationInput = {
  runId: string;
  idea: NovaEvaluatedIdea;
};

export type ForgeGenerationResult = {
  mode: ForgeGenerationMode;
  listingTitle: string;
  listingDescription: string;
  seoTags: string[];
  suggestedPrice: number;
  productStructure: ProductStructure;
  complianceNotes: string[];
  aiDisclosure: string;
  coverImagePrompt: string;
  revisionNotes: string[];
  llmModel?: string;
  promptVersion: string;
  tokenEstimateInput?: number;
  tokenEstimateOutput?: number;
};

const FORGE_PAGE_KIND_TO_DOMAIN: Record<
  z.infer<typeof ForgePageKindSchema>,
  NonNullable<ProductStructure["pages"][number]["metadata"]>["pageKind"]
> = {
  cover: "cover",
  instructions: "intro",
  worksheet: "worksheet",
  summary: "summary",
};

export function mapForgeStructureToDomain(
  raw: ForgeLlmProductStructure,
  metadata?: Record<string, unknown>,
): ProductStructure {
  return {
    format: raw.format.trim(),
    pageCount: raw.pages.length,
    pages: raw.pages.map((page) => {
      const kind =
        page.pageKind ?? inferForgePageKind(page, raw.pages.length);
      return {
        pageNumber: page.pageNumber,
        title: page.title.trim(),
        purpose: page.purpose.trim(),
        userInstructions: page.userInstructions.trim(),
        metadata: {
          pageKind: FORGE_PAGE_KIND_TO_DOMAIN[kind],
        },
        sections: page.sections.map((section) => ({
          id: section.id.trim(),
          heading: section.heading.trim(),
          body: section.body?.trim(),
          fields: section.fields?.map((field) => ({
            id: field.id.trim(),
            label: field.label.trim(),
            fieldType: field.fieldType,
            placeholder: field.placeholder?.trim(),
          })),
          table: section.table
            ? {
                id: section.table.id,
                headers: section.table.headers.map((h) => h.trim()),
                rowCount: section.table.rowCount,
              }
            : undefined,
          checklist: section.checklist
            ? {
                id: section.checklist.id,
                title: section.checklist.title?.trim(),
                items: section.checklist.items.map((i) => i.trim()),
              }
            : undefined,
        })),
      };
    }),
    metadata,
  };
}

export function ensureAiDisclosureInCopy(text: string): string {
  if (text.includes(AI_DISCLOSURE_TEXT)) return text;
  return `${text.trim()}\n\n${AI_DISCLOSURE_TEXT}`;
}
