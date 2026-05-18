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
const SECTION_GAP = 18;
const FOOTER_SIZE = 8;
const PAGE_NUM_SIZE = 9;
const MIN_Y = MARGIN + 36;

const COLORS = {
  ink: rgb(0.12, 0.12, 0.12),
  muted: rgb(0.42, 0.42, 0.42),
  line: rgb(0.78, 0.78, 0.78),
  fieldFill: rgb(0.98, 0.98, 0.98),
  coverBand: rgb(0.94, 0.95, 0.97),
};

type LayoutContext = {
  pdfDoc: PDFDocument;
  page: PDFPage;
  regular: PDFFont;
  bold: PDFFont;
  y: number;
  pageIndex: number;
  footerLine?: string;
  disclosureNote?: string;
};

function disclosureText(document: ProductDocument): string | undefined {
  return document.disclosureNote?.trim() ?? document.footerNote?.trim();
}

/** Deterministic rich sample for unit tests and local PDF smoke checks. */
export function createSampleProduct(): ProductDocument {
  const worksheetSections = (
    title: string,
    rows: { id: string; label: string; type: ProductField["type"] }[],
  ): ProductSection[] => [
    {
      id: `${title}-main`,
      title,
      description: "Fill in during your weekly prep session.",
      fields: rows.map((r) => ({
        id: r.id,
        label: r.label,
        type: r.type,
        placeholder: " ",
      })),
    },
    {
      id: `${title}-checklist`,
      title: "Prep checklist",
      checklist: {
        id: `${title}-cl`,
        items: [
          "Review calendar for the week",
          "Check pantry staples",
          "Batch cook proteins",
          "Portion snacks",
          "Label containers",
        ],
      },
      fields: [],
    },
  ];

  return {
    title: "Weekly Meal Prep Planner",
    subtitle: "Plan meals, groceries, and prep windows",
    format: "planner",
    audience: "Busy home cooks",
    footerLine: "Personal use only — not medical or nutritional advice.",
    disclosureNote:
      "AI tools assisted in drafting and structuring this digital product. The seller reviewed and customized the final product.",
    pages: [
      {
        id: "cover",
        kind: "cover",
        title: "Weekly Meal Prep Planner",
        purpose: "Cover",
        sections: [],
      },
      {
        id: "intro",
        kind: "intro",
        title: "How to use this planner",
        purpose: "Orient the buyer before filling worksheets",
        userInstructions:
          "Print at 100% scale on US Letter. Duplicate worksheet pages as needed.",
        sections: [
          {
            id: "intro-steps",
            title: "Getting started",
            description:
              "1. Skim the week overview. 2. Build your grocery list. 3. Run prep using the checklists.",
            fields: [
              {
                id: "name",
                label: "Your name (optional)",
                type: "text",
              },
            ],
          },
        ],
      },
      {
        id: "week-overview",
        kind: "worksheet",
        title: "Week at a Glance",
        sections: [
          {
            id: "meals",
            title: "Daily meals",
            table: {
              id: "meal-grid",
              headers: ["Day", "Breakfast", "Lunch", "Dinner", "Notes"],
              rows: Array.from({ length: 7 }, () => ["", "", "", "", ""]),
            },
            fields: [],
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
        id: "grocery-1",
        kind: "worksheet",
        title: "Grocery Run — List A",
        sections: worksheetSections("Items", [
          { id: "i1", label: "Item 1", type: "text" },
          { id: "i2", label: "Item 2", type: "text" },
          { id: "i3", label: "Item 3", type: "text" },
          { id: "i4", label: "Item 4", type: "text" },
        ]),
      },
      {
        id: "grocery-2",
        kind: "worksheet",
        title: "Grocery Run — List B",
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
            title: "Additional items",
            fields: Array.from({ length: 8 }, (_, i) => ({
              id: `item-${i + 1}`,
              label: `Item ${i + 1}`,
              type: "text" as const,
              placeholder: "Ingredient",
            })),
          },
        ],
      },
      {
        id: "prep-log",
        kind: "worksheet",
        title: "Prep session log",
        sections: [
          {
            id: "session",
            title: "Session notes",
            fields: [
              { id: "duration", label: "Time spent (min)", type: "number" },
              { id: "wins", label: "What worked", type: "textarea" },
              { id: "next", label: "Next time", type: "textarea" },
            ],
          },
        ],
      },
      {
        id: "summary",
        kind: "summary",
        title: "Week in review",
        purpose: "Reflect and plan the next cycle",
        userInstructions: "Complete at week end. Keep for your records.",
        sections: [
          {
            id: "reflection",
            title: "Reflection",
            fields: [
              { id: "best", label: "Best meal this week", type: "text" },
              { id: "adjust", label: "One adjustment for next week", type: "textarea" },
            ],
            linedLines: 4,
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

  const disclosure = disclosureText(document);
  let ctx: LayoutContext = newPage(pdfDoc, regular, bold, 0, {
    footerLine: document.footerLine,
    disclosureNote: disclosure,
  });

  const pages = document.pages.length > 0 ? document.pages : legacySinglePage(document);

  for (let i = 0; i < pages.length; i++) {
    const productPage = pages[i]!;
    const kind = productPage.kind ?? (i === 0 ? "content" : "worksheet");

    if (i > 0) {
      const nextIndex = ctx.pdfDoc.getPageCount();
      ctx = newPage(ctx.pdfDoc, ctx.regular, ctx.bold, nextIndex, {
        footerLine: ctx.footerLine,
        disclosureNote: ctx.disclosureNote,
      });
    }

    if (kind === "cover") {
      ctx = drawCoverPage(ctx, document, productPage);
      continue;
    }

    ctx = drawWorksheetPageHeader(ctx, productPage);

    for (const section of productPage.sections) {
      ctx = drawSection(ctx, section);
    }
  }

  stampPageNumbersAndFooters(ctx);
  return pdfDoc.save();
}

/** Same as {@link generateProductPdf} but returns a Node `Buffer`. */
export async function generateProductPdfBuffer(
  document: ProductDocument,
): Promise<Buffer> {
  const bytes = await generateProductPdf(document);
  return Buffer.from(bytes);
}

function legacySinglePage(document: ProductDocument): ProductPage[] {
  return [
    {
      id: "legacy",
      kind: "content",
      title: document.title,
      sections: [
        {
          id: "body",
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
  ];
}

function newPage(
  pdfDoc: PDFDocument,
  regular: PDFFont,
  bold: PDFFont,
  pageIndex: number,
  meta: Pick<LayoutContext, "footerLine" | "disclosureNote">,
): LayoutContext {
  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  return {
    pdfDoc,
    page,
    regular,
    bold,
    y: PAGE_HEIGHT - MARGIN,
    pageIndex,
    ...meta,
  };
}

function drawCoverPage(
  ctx: LayoutContext,
  document: ProductDocument,
  productPage: ProductPage,
): LayoutContext {
  const bandHeight = 120;
  ctx.page.drawRectangle({
    x: 0,
    y: PAGE_HEIGHT - bandHeight - 80,
    width: PAGE_WIDTH,
    height: bandHeight,
    color: COLORS.coverBand,
  });

  let next = ctx;
  next.y = PAGE_HEIGHT - MARGIN - 40;

  next = drawWrappedText(next, productPage.title || document.title, {
    font: next.bold,
    size: 26,
    color: COLORS.ink,
    maxLines: 3,
    shrinkToFit: true,
  });

  if (document.subtitle) {
    next.y -= 8;
    next = drawWrappedText(next, document.subtitle, {
      font: next.regular,
      size: 13,
      color: COLORS.muted,
      maxLines: 3,
      shrinkToFit: true,
    });
  }

  next.y -= 24;
  const meta: string[] = [];
  if (document.format) meta.push(`Format: ${document.format}`);
  if (document.audience) meta.push(`For: ${document.audience}`);
  if (meta.length > 0) {
    next = drawWrappedText(next, meta.join("  ·  "), {
      font: next.regular,
      size: 10,
      color: COLORS.muted,
      maxLines: 2,
    });
  }

  if (productPage.purpose && productPage.purpose !== "Cover") {
    next.y -= 16;
    next = drawWrappedText(next, productPage.purpose, {
      font: next.regular,
      size: 10,
      color: COLORS.ink,
      maxLines: 4,
    });
  }

  next.y = MARGIN + 80;
  drawHorizontalRule(next, next.y + 40);
  next = drawWrappedText(next, "Printable digital download — fill, save, or print.", {
    font: next.regular,
    size: 9,
    color: COLORS.muted,
    maxLines: 2,
  });

  return next;
}

function drawWorksheetPageHeader(
  ctx: LayoutContext,
  productPage: ProductPage,
): LayoutContext {
  let next = drawWrappedText(ctx, productPage.title, {
    font: ctx.bold,
    size: 15,
    color: COLORS.ink,
    maxLines: 2,
    shrinkToFit: true,
  });
  next.y -= 4;

  if (productPage.purpose) {
    next = drawWrappedText(next, productPage.purpose, {
      font: ctx.regular,
      size: 9,
      color: COLORS.muted,
      maxLines: 3,
    });
    next.y -= 4;
  }

  if (productPage.userInstructions) {
    next = drawWrappedText(next, productPage.userInstructions, {
      font: ctx.regular,
      size: 8,
      color: COLORS.muted,
      maxLines: 4,
    });
    next.y -= 6;
  }

  drawHorizontalRule(next, next.y);
  next.y -= SECTION_GAP;
  return next;
}

function drawSection(ctx: LayoutContext, section: ProductSection): LayoutContext {
  let next = ensureSpace(ctx, 40);

  if (section.title) {
    next = drawWrappedText(next, section.title, {
      font: next.bold,
      size: 11,
      color: COLORS.ink,
      maxLines: 2,
      shrinkToFit: true,
    });
    next.y -= 4;
  }

  if (section.description) {
    next = drawWrappedText(next, section.description, {
      font: next.regular,
      size: 9,
      color: COLORS.muted,
      maxLines: 6,
      shrinkToFit: true,
    });
    next.y -= 6;
  }

  if (section.table) {
    next = drawTable(next, section.table.headers, section.table.rows);
    next.y -= SECTION_GAP;
  }

  if (section.checklist) {
    if (section.checklist.title) {
      next = drawWrappedText(next, section.checklist.title, {
        font: next.bold,
        size: 10,
        color: COLORS.ink,
        maxLines: 2,
      });
      next.y -= 4;
    }
    for (const item of section.checklist.items) {
      next = drawCheckboxRow(next, item);
      next.y -= 6;
    }
    next.y -= SECTION_GAP - 6;
  }

  for (const field of section.fields) {
    next = drawField(next, field);
    next.y -= FIELD_GAP;
  }

  if (section.linedLines && section.linedLines > 0) {
    next = drawLinedArea(next, section.linedLines);
    next.y -= SECTION_GAP;
  }

  next.y -= SECTION_GAP - FIELD_GAP;
  return next;
}

function drawTable(
  ctx: LayoutContext,
  headers: string[],
  rows: string[][],
): LayoutContext {
  const colCount = headers.length;
  const colWidth = CONTENT_WIDTH / colCount;
  const headerHeight = 18;
  const rowHeight = 22;
  const blockHeight = headerHeight + rows.length * rowHeight + 8;

  const next = ensureSpace(ctx, blockHeight);
  let yTop = next.y;

  for (let c = 0; c < colCount; c++) {
    const x = MARGIN + c * colWidth;
    next.page.drawRectangle({
      x,
      y: yTop - headerHeight,
      width: colWidth,
      height: headerHeight,
      color: COLORS.coverBand,
      borderColor: COLORS.line,
      borderWidth: 0.5,
    });
    const headerText = truncate(headers[c] ?? "", 18);
    next.page.drawText(headerText, {
      x: x + 4,
      y: yTop - headerHeight + 5,
      size: 8,
      font: next.bold,
      color: COLORS.ink,
    });
  }

  yTop -= headerHeight;

  for (const row of rows) {
    yTop -= rowHeight;
    for (let c = 0; c < colCount; c++) {
      const x = MARGIN + c * colWidth;
      next.page.drawRectangle({
        x,
        y: yTop,
        width: colWidth,
        height: rowHeight,
        borderColor: COLORS.line,
        borderWidth: 0.5,
      });
      const cell = row[c] ?? "";
      if (cell) {
        next.page.drawText(truncate(cell, 22), {
          x: x + 4,
          y: yTop + 6,
          size: 8,
          font: next.regular,
          color: COLORS.muted,
        });
      }
    }
  }

  next.y = yTop - 8;
  return next;
}

function drawCheckboxRow(ctx: LayoutContext, label: string): LayoutContext {
  const boxSize = 11;
  const blockHeight = Math.max(boxSize + 4, LINE_HEIGHT + 8);
  const next = ensureSpace(ctx, blockHeight + 4);
  const boxY = next.y - boxSize - 2;

  next.page.drawRectangle({
    x: MARGIN,
    y: boxY,
    width: boxSize,
    height: boxSize,
    borderColor: COLORS.line,
    borderWidth: 1,
  });

  const lines = wrapText(label, next.regular, 9, CONTENT_WIDTH - boxSize - 12);
  for (let i = 0; i < lines.length; i++) {
    next.page.drawText(lines[i]!, {
      x: MARGIN + boxSize + 8,
      y: boxY + (lines.length - 1 - i) * 11,
      size: 9,
      font: next.regular,
      color: COLORS.ink,
    });
  }

  next.y = boxY - 6;
  return next;
}

function drawLinedArea(ctx: LayoutContext, lineCount: number): LayoutContext {
  const lineSpacing = 16;
  const blockHeight = lineCount * lineSpacing + 8;
  const next = ensureSpace(ctx, blockHeight);

  for (let i = 0; i < lineCount; i++) {
    const y = next.y - i * lineSpacing - 8;
    next.page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_WIDTH - MARGIN, y },
      thickness: 0.5,
      color: COLORS.line,
    });
  }

  next.y -= blockHeight;
  return next;
}

function drawField(ctx: LayoutContext, field: ProductField): LayoutContext {
  const labelLines = wrapText(field.label, ctx.bold, 10, CONTENT_WIDTH);
  const labelHeight = labelLines.length * (LINE_HEIGHT + 2);
  const fieldHeight = fieldHeightForType(field.type);
  const blockHeight = labelHeight + fieldHeight + 8;

  const next = ensureSpace(ctx, blockHeight);
  let labelY = next.y;

  for (const line of labelLines) {
    next.page.drawText(line, {
      x: MARGIN,
      y: labelY - LINE_HEIGHT,
      size: 10,
      font: next.bold,
      color: COLORS.ink,
    });
    labelY -= LINE_HEIGHT + 2;
  }

  const fieldTop = labelY - 4;
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
      const hintLines = wrapText(field.hint, next.regular, 9, CONTENT_WIDTH - 24);
      for (let i = 0; i < hintLines.length; i++) {
        next.page.drawText(hintLines[i]!, {
          x: MARGIN + boxSize + 8,
          y: boxY + i * 11,
          size: 9,
          font: next.regular,
          color: COLORS.muted,
        });
      }
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
    if (placeholder && placeholder.trim()) {
      const phLines = wrapText(placeholder.trim(), next.regular, 8, CONTENT_WIDTH - 12);
      const startY =
        field.type === "textarea"
          ? boxY + fieldHeight - 12
          : boxY + (fieldHeight - 8) / 2;
      for (let i = 0; i < Math.min(phLines.length, field.type === "textarea" ? 4 : 1); i++) {
        next.page.drawText(phLines[i]!, {
          x: MARGIN + 6,
          y: startY - i * 10,
          size: 8,
          font: next.regular,
          color: COLORS.muted,
        });
      }
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
    shrinkToFit?: boolean;
  },
): LayoutContext {
  let size = options.size;
  let lines = wrapText(text, options.font, size, CONTENT_WIDTH);

  if (options.shrinkToFit && lines.length > options.maxLines) {
    size = Math.max(8, size - 2);
    lines = wrapText(text, options.font, size, CONTENT_WIDTH);
  }

  lines = lines.slice(0, options.maxLines);
  const needed = lines.length * (size + 4) + 4;
  const next = ensureSpace(ctx, needed);

  for (const line of lines) {
    next.page.drawText(line, {
      x: MARGIN,
      y: next.y - size,
      size,
      font: options.font,
      color: options.color,
    });
    next.y -= size + 4;
  }

  return next;
}

function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized) return [""];

  const words = normalized.split(" ");
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

  const pageIndex = ctx.pdfDoc.getPageCount();
  return newPage(ctx.pdfDoc, ctx.regular, ctx.bold, pageIndex, {
    footerLine: ctx.footerLine,
    disclosureNote: ctx.disclosureNote,
  });
}

function drawHorizontalRule(ctx: LayoutContext, y: number): void {
  ctx.page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_WIDTH - MARGIN, y },
    thickness: 0.75,
    color: COLORS.line,
  });
}

function stampPageNumbersAndFooters(ctx: LayoutContext): void {
  const pages = ctx.pdfDoc.getPages();
  const total = pages.length;
  const lastIndex = total - 1;

  for (let i = 0; i < total; i++) {
    const page = pages[i]!;
    const pageNum = `${i + 1} / ${total}`;
    const numWidth = ctx.regular.widthOfTextAtSize(pageNum, PAGE_NUM_SIZE);

    page.drawText(pageNum, {
      x: PAGE_WIDTH - MARGIN - numWidth,
      y: MARGIN - 4,
      size: PAGE_NUM_SIZE,
      font: ctx.regular,
      color: COLORS.muted,
    });

    if (ctx.footerLine) {
      page.drawText(truncate(ctx.footerLine, 72), {
        x: MARGIN,
        y: MARGIN - 4,
        size: FOOTER_SIZE,
        font: ctx.regular,
        color: COLORS.muted,
      });
    }

    if (i === lastIndex && ctx.disclosureNote) {
      const note = ctx.disclosureNote;
      const lines = wrapText(note, ctx.regular, FOOTER_SIZE, CONTENT_WIDTH);
      let y = MARGIN + 14;
      for (const line of lines.slice(-3)) {
        page.drawText(line, {
          x: MARGIN,
          y,
          size: FOOTER_SIZE,
          font: ctx.regular,
          color: COLORS.muted,
        });
        y += FOOTER_SIZE + 3;
      }
    }
  }
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}
