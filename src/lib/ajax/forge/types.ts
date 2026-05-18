import { z } from "zod";
import type { ProductStructure } from "@/lib/product/domain";
import type { NovaEvaluatedIdea } from "@/lib/ajax/nova/types";

export const FORGE_PROMPT_VERSION = "forge-generation-v1";

export const AI_DISCLOSURE_TEXT =
  "AI tools assisted in drafting and structuring this digital product. The seller reviewed and customized the final product.";

export type ForgeGenerationMode = "llm" | "fallback";

const ForgeFieldSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  fieldType: z.enum(["text", "checkbox", "number", "date", "notes"]),
  placeholder: z.string().optional(),
});

const ForgeSectionSchema = z.object({
  id: z.string().min(1),
  heading: z.string().min(1),
  body: z.string().optional(),
  fields: z.array(ForgeFieldSchema).optional(),
});

const ForgePageSchema = z.object({
  pageNumber: z.number().int().positive(),
  title: z.string().min(1),
  purpose: z.string().min(1),
  userInstructions: z.string().min(1),
  sections: z.array(ForgeSectionSchema).min(1),
});

export const ForgeProductStructureSchema = z
  .object({
    format: z.string().min(1),
    pages: z.array(ForgePageSchema).min(1).max(24),
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

export function mapForgeStructureToDomain(
  raw: ForgeLlmProductStructure,
  metadata?: Record<string, unknown>,
): ProductStructure {
  return {
    format: raw.format.trim(),
    pageCount: raw.pages.length,
    pages: raw.pages.map((page) => ({
      pageNumber: page.pageNumber,
      title: page.title.trim(),
      purpose: page.purpose.trim(),
      userInstructions: page.userInstructions.trim(),
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
      })),
    })),
    metadata,
  };
}

export function ensureAiDisclosureInCopy(text: string): string {
  if (text.includes(AI_DISCLOSURE_TEXT)) return text;
  return `${text.trim()}\n\n${AI_DISCLOSURE_TEXT}`;
}
