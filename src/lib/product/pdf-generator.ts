/**
 * Server-only PDF generation — import from API routes or server actions, not client components.
 */
import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from "pdf-lib";

import type {
  ProductDocument,
  ProductField,
  ProductPage,
  ProductSection,
} from "@/lib/product/types";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const LINE_HEIGHT = 13;
const FIELD_GAP = 10;
const SECTION_GAP = 22;
const FOOTER_SIZE = 9;
const MIN_Y = MARGIN + 28;

const COLORS = {
  ink: rgb(0.12, 0.12, 0.12),
  muted: rgb(0.42, 0.42, 0.42),
  line: rgb(0.78, 0.78, 0.78),
  fieldFill: rgb(0.98, 0.98, 0.98),
};

type LayoutContext = {
  pdfDoc: PDFDocument;
  page: PDFPage;
  regular: PDFFont;
  bold: PDFFont;
  y: number;
  footerNote?: string;
};

/** Deterministic sample product for unit tests and local PDF smoke checks. */
export function createSampleProduct(): ProductDocument {
  return {
    title: "Weekly Meal Prep Planner",
    subtitle: "Plan meals, groceries, and prep windows",
    format: "planner",
    audience: "Busy home cooks",
    footerNote: "For personal use only. Not medical or nutritional advice.",
    pages: [
      {
        id: "week-overview",
        title: "Week at a Glance",
        sections: [
          {
            id: "meals",
            title: "Daily meals",
            description: "Outline breakfast, lunch, and dinner for each day.",
            fields: [
              {
                id: "mon-meals",
                label: "Monday",
                type: "textarea",
                placeholder: "Breakfast / Lunch / Dinner",
              },
              {
                id: "tue-meals",
                label: "Tuesday",
                type: "textarea",
                placeholder: "Breakfast / Lunch / Dinner",
              },
              {
                id: "wed-meals",
                label: "Wednesday",
                type: "textarea",
                placeholder: "Breakfast / Lunch / Dinner",
              },
            ],
          },
          {
            id: "prep",
            title: "Prep checklist",
            fields: [
              { id: "shop", label: "Grocery list complete", type: "checkbox" },
              { id: "chop", label: "Produce washed and chopped", type: "checkbox" },
              { id: "portions", label: "Containers labeled", type: "checkbox" },
            ],
          },
        ],
      },
      {
        id: "grocery-log",
        title: "Grocery Run",
        sections: [
          {
            id: "run-meta",
            fields: [
              { id: "run-date", label: "Shopping date", type: "date" },
              { id: "budget", label: "Budget ($)", type: "number", placeholder: "0.00" },
            ],
          },
          {
            id: "items",
            title: "Items to buy",
            fields: [
              { id: "item-1", label: "Item 1", type: "text", placeholder: "Ingredient" },
              { id: "item-2", label: "Item 2", type: "text", placeholder: "Ingredient" },
              { id: "item-3", label: "Item 3", type: "text", placeholder: "Ingredient" },
              { id: "item-4", label: "Item 4", type: "text", placeholder: "Ingredient" },
            ],
          },
        ],
      },
    ],
  };
}

/** Render a structured product document to PDF bytes. */
export async function generateProductPdf(
  document: ProductDocument,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let ctx: LayoutContext = {
    pdfDoc,
    page,
    regular,
    bold,
    y: PAGE_HEIGHT - MARGIN,
    footerNote: document.footerNote,
  };

  ctx = drawDocumentHeader(ctx, document);

  for (const productPage of document.pages) {
    ctx = ensureSpace(ctx, 72);
    ctx = drawPageTitle(ctx, productPage);

    for (const section of productPage.sections) {
      ctx = drawSection(ctx, section);
    }
  }

  stampFooters(ctx);
  return pdfDoc.save();
}

/** Same as {@link generateProductPdf} but returns a Node `Buffer`. */
export async function generateProductPdfBuffer(
  document: ProductDocument,
): Promise<Buffer> {
  const bytes = await generateProductPdf(document);
  return Buffer.from(bytes);
}

function drawDocumentHeader(
  ctx: LayoutContext,
  document: ProductDocument,
): LayoutContext {
  let next = drawWrappedText(ctx, document.title, {
    font: ctx.bold,
    size: 18,
    color: COLORS.ink,
    maxLines: 2,
  });

  if (document.subtitle) {
    next = drawWrappedText(next, document.subtitle, {
      font: ctx.regular,
      size: 11,
      color: COLORS.muted,
      maxLines: 2,
    });
  }

  const meta: string[] = [];
  if (document.format) meta.push(`Format: ${document.format}`);
  if (document.audience) meta.push(`For: ${document.audience}`);
  if (meta.length > 0) {
    next = drawWrappedText(next, meta.join("  ·  "), {
      font: ctx.regular,
      size: 9,
      color: COLORS.muted,
      maxLines: 2,
    });
  }

  next.y -= 8;
  drawHorizontalRule(next, next.y);
  next.y -= SECTION_GAP;
  return next;
}

function drawPageTitle(ctx: LayoutContext, productPage: ProductPage): LayoutContext {
  const next = drawWrappedText(ctx, productPage.title, {
    font: ctx.bold,
    size: 14,
    color: COLORS.ink,
    maxLines: 2,
  });
  next.y -= 6;
  return next;
}

function drawSection(ctx: LayoutContext, section: ProductSection): LayoutContext {
  let next = ensureSpace(ctx, 40);

  if (section.title) {
    next = drawWrappedText(next, section.title, {
      font: ctx.bold,
      size: 11,
      color: COLORS.ink,
      maxLines: 2,
    });
    next.y -= 4;
  }

  if (section.description) {
    next = drawWrappedText(next, section.description, {
      font: ctx.regular,
      size: 9,
      color: COLORS.muted,
      maxLines: 4,
    });
    next.y -= 6;
  }

  for (const field of section.fields) {
    next = drawField(next, field);
    next.y -= FIELD_GAP;
  }

  next.y -= SECTION_GAP - FIELD_GAP;
  return next;
}

function drawField(ctx: LayoutContext, field: ProductField): LayoutContext {
  const labelHeight = LINE_HEIGHT + 4;
  const fieldHeight = fieldHeightForType(field.type);
  const blockHeight = labelHeight + fieldHeight + 4;

  const next = ensureSpace(ctx, blockHeight);
  const labelY = next.y;

  next.page.drawText(field.label, {
    x: MARGIN,
    y: labelY - LINE_HEIGHT,
    size: 10,
    font: next.bold,
    color: COLORS.ink,
  });

  const fieldTop = labelY - labelHeight - 2;
  const boxY = fieldTop - fieldHeight;

  if (field.type === "checkbox") {
    const boxSize = 12;
    next.page.drawRectangle({
      x: MARGIN,
      y: boxY,
      width: boxSize,
      height: boxSize,
      borderColor: COLORS.line,
      borderWidth: 1,
    });
    if (field.hint) {
      next.page.drawText(field.hint, {
        x: MARGIN + boxSize + 8,
        y: boxY + 2,
        size: 9,
        font: next.regular,
        color: COLORS.muted,
      });
    }
  } else {
    next.page.drawRectangle({
      x: MARGIN,
      y: boxY,
      width: CONTENT_WIDTH,
      height: fieldHeight,
      color: COLORS.fieldFill,
      borderColor: COLORS.line,
      borderWidth: 0.75,
    });

    const placeholder = field.placeholder ?? field.defaultValue;
    if (placeholder) {
      next.page.drawText(truncate(placeholder, 72), {
        x: MARGIN + 6,
        y: boxY + (field.type === "textarea" ? fieldHeight - 14 : 6),
        size: 8,
        font: next.regular,
        color: COLORS.muted,
      });
    }
  }

  next.y = boxY - 4;
  return next;
}

function fieldHeightForType(type: ProductField["type"]): number {
  switch (type) {
    case "textarea":
      return 56;
    case "checkbox":
      return 14;
    default:
      return 26;
  }
}

function drawWrappedText(
  ctx: LayoutContext,
  text: string,
  options: {
    font: PDFFont;
    size: number;
    color: ReturnType<typeof rgb>;
    maxLines: number;
  },
): LayoutContext {
  const lines = wrapText(text, options.font, options.size, CONTENT_WIDTH).slice(
    0,
    options.maxLines,
  );
  const needed = lines.length * (options.size + 4) + 4;
  const next = ensureSpace(ctx, needed);

  for (const line of lines) {
    next.page.drawText(line, {
      x: MARGIN,
      y: next.y - options.size,
      size: options.size,
      font: options.font,
      color: options.color,
    });
    next.y -= options.size + 4;
  }

  return next;
}

function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const words = text.trim().split(/\s+/);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let current = words[0] ?? "";

  for (const word of words.slice(1)) {
    const candidate = `${current} ${word}`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }

  lines.push(current);
  return lines;
}

function ensureSpace(ctx: LayoutContext, required: number): LayoutContext {
  if (ctx.y - required >= MIN_Y) {
    return ctx;
  }

  const page = ctx.pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  return {
    ...ctx,
    page,
    y: PAGE_HEIGHT - MARGIN,
  };
}

function drawHorizontalRule(ctx: LayoutContext, y: number): void {
  ctx.page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_WIDTH - MARGIN, y },
    thickness: 0.75,
    color: COLORS.line,
  });
}

function stampFooters(ctx: LayoutContext): void {
  if (!ctx.footerNote) return;

  const pages = ctx.pdfDoc.getPages();
  for (const page of pages) {
    page.drawText(truncate(ctx.footerNote, 90), {
      x: MARGIN,
      y: MARGIN - 6,
      size: FOOTER_SIZE,
      font: ctx.regular,
      color: COLORS.muted,
    });
  }
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}
