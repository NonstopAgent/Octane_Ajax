/**
 * Server-only PDF generation — import from API routes or server actions, not client components.
 */
import {
  PDFDocument,
  StandardFonts,
  appendBezierCurve,
  closePath,
  fill,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setFillingRgbColor,
  setLineWidth,
  setStrokingRgbColor,
  stroke,
  type PDFPage,
  type PDFFont,
  type RGB,
} from "pdf-lib";

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
const LINE_HEIGHT = 12;
const FIELD_GAP = 10;
const SECTION_GAP = 18;
const SECTION_RULE_GAP = 8;
const MIN_Y = MARGIN + 36;
const COVER_BAND_HEIGHT = 140;
const FIELD_RADIUS = 4;
const COVER_DISCLOSURE = "Created with AI assistance";

const FONT = {
  title: 22,
  section: 14,
  body: 10,
  label: 9,
  footer: 7,
} as const;

const COLORS = {
  ink: rgb(0.12, 0.12, 0.12),
  muted: rgb(0.42, 0.42, 0.42),
  line: rgb(0.78, 0.78, 0.78),
  white: rgb(1, 1, 1),
  accent: rgb(0.22, 0.35, 0.53),
  tableHeader: rgb(0.35, 0.45, 0.58),
  rowAlt: rgb(0.96, 0.96, 0.96),
  fieldFill: rgb(0.99, 0.99, 0.99),
};

const TABLE_CELL_PAD_V = 4;
const TABLE_CELL_PAD_H = 8;

type LayoutContext = {
  pdfDoc: PDFDocument;
  page: PDFPage;
  regular: PDFFont;
  bold: PDFFont;
  y: number;
  pageIndex: number;
  productTitle: string;
  coverPageIndex?: number;
  footerLine?: string;
  disclosureNote?: string;
};

function disclosureText(document: ProductDocument): string | undefined {
  return document.disclosureNote?.trim() ?? document.footerNote?.trim();
}

function coverSubtitle(document: ProductDocument): string | undefined {
  const format = document.format?.trim();
  const niche = document.audience?.trim();
  if (format && niche) return `A ${format} for ${niche}`;
  if (format) return `A ${format}`;
  if (niche) return `For ${niche}`;
  return document.subtitle?.trim();
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
    productTitle: document.title,
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
        productTitle: ctx.productTitle,
        footerLine: ctx.footerLine,
        disclosureNote: ctx.disclosureNote,
        coverPageIndex: ctx.coverPageIndex,
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
  meta: Pick<
    LayoutContext,
    "productTitle" | "footerLine" | "disclosureNote" | "coverPageIndex"
  >,
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
  const bandBottom = PAGE_HEIGHT - COVER_BAND_HEIGHT;
  ctx.page.drawRectangle({
    x: 0,
    y: bandBottom,
    width: PAGE_WIDTH,
    height: COVER_BAND_HEIGHT,
    color: COLORS.accent,
  });

  const title = productPage.title || document.title;
  const titleLines = wrapText(title, ctx.bold, FONT.title, CONTENT_WIDTH - 80).slice(0, 3);
  const subtitle = coverSubtitle(document);
  const subtitleLines = subtitle
    ? wrapText(subtitle, ctx.regular, FONT.body, CONTENT_WIDTH - 80).slice(0, 2)
    : [];

  const titleBlockHeight =
    titleLines.length * (FONT.title + 6) +
    (subtitleLines.length > 0 ? subtitleLines.length * (FONT.body + 4) + 8 : 0);
  const bandCenterY = bandBottom + COVER_BAND_HEIGHT / 2;
  let textY = bandCenterY + titleBlockHeight / 2 - FONT.title;

  drawCenteredLines(ctx.page, titleLines, textY, ctx.bold, FONT.title, COLORS.white);
  textY -= titleLines.length * (FONT.title + 6) + 6;

  if (subtitleLines.length > 0) {
    drawCenteredLines(ctx.page, subtitleLines, textY, ctx.regular, FONT.body, COLORS.white);
  }

  drawCenteredText(
    ctx.page,
    COVER_DISCLOSURE,
    MARGIN + 6,
    ctx.regular,
    FONT.footer,
    COLORS.muted,
  );

  return {
    ...ctx,
    coverPageIndex: ctx.pageIndex,
    y: bandBottom - SECTION_GAP,
  };
}

function drawWorksheetPageHeader(
  ctx: LayoutContext,
  productPage: ProductPage,
): LayoutContext {
  let next = drawWrappedText(ctx, productPage.title, {
    font: ctx.bold,
    size: FONT.section,
    color: COLORS.ink,
    maxLines: 2,
    shrinkToFit: true,
  });
  next.y -= 4;

  if (productPage.purpose) {
    next = drawWrappedText(next, productPage.purpose, {
      font: ctx.regular,
      size: FONT.body,
      color: COLORS.muted,
      maxLines: 3,
    });
    next.y -= 4;
  }

  if (productPage.userInstructions) {
    next = drawWrappedText(next, productPage.userInstructions, {
      font: ctx.regular,
      size: FONT.body,
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
  let next = ensureSpace(ctx, 48);

  if (section.title) {
    drawAccentRule(next, next.y);
    next.y -= SECTION_RULE_GAP;
    next = drawWrappedText(next, section.title, {
      font: next.bold,
      size: FONT.section,
      color: COLORS.ink,
      maxLines: 2,
      shrinkToFit: true,
    });
    next.y -= 4;
  }

  if (section.description) {
    next = drawWrappedText(next, section.description, {
      font: next.regular,
      size: FONT.body,
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
        size: FONT.body,
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
  const headerHeight = FONT.body + TABLE_CELL_PAD_V * 2;
  const rowHeight = FONT.body + TABLE_CELL_PAD_V * 2;
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
      color: COLORS.tableHeader,
      borderColor: COLORS.line,
      borderWidth: 0.5,
    });
    const headerText = truncate(headers[c] ?? "", 18);
    next.page.drawText(headerText, {
      x: x + TABLE_CELL_PAD_H,
      y: yTop - headerHeight + TABLE_CELL_PAD_V,
      size: FONT.body,
      font: next.bold,
      color: COLORS.white,
    });
  }

  yTop -= headerHeight;

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;
    yTop -= rowHeight;
    const rowFill = r % 2 === 1 ? COLORS.rowAlt : COLORS.white;
    for (let c = 0; c < colCount; c++) {
      const x = MARGIN + c * colWidth;
      next.page.drawRectangle({
        x,
        y: yTop,
        width: colWidth,
        height: rowHeight,
        color: rowFill,
        borderColor: COLORS.line,
        borderWidth: 0.5,
      });
      const cell = row[c] ?? "";
      if (cell) {
        next.page.drawText(truncate(cell, 22), {
          x: x + TABLE_CELL_PAD_H,
          y: yTop + TABLE_CELL_PAD_V,
          size: FONT.body,
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

  drawSquareOutline(next.page, MARGIN, boxY, boxSize);

  const lines = wrapText(label, next.regular, FONT.body, CONTENT_WIDTH - boxSize - 12);
  for (let i = 0; i < lines.length; i++) {
    next.page.drawText(lines[i]!, {
      x: MARGIN + boxSize + 8,
      y: boxY + (lines.length - 1 - i) * (FONT.body + 2),
      size: FONT.body,
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
  const labelLines = wrapText(field.label, ctx.regular, FONT.label, CONTENT_WIDTH);
  const labelHeight = labelLines.length * (FONT.label + 3);
  const fieldHeight = fieldHeightForType(field.type);
  const blockHeight = labelHeight + fieldHeight + 10;

  const next = ensureSpace(ctx, blockHeight);
  let labelY = next.y;

  for (const line of labelLines) {
    next.page.drawText(line, {
      x: MARGIN,
      y: labelY - FONT.label,
      size: FONT.label,
      font: next.regular,
      color: COLORS.muted,
    });
    labelY -= FONT.label + 3;
  }

  const fieldTop = labelY - 4;
  const boxY = fieldTop - fieldHeight;

  if (field.type === "checkbox") {
    const boxSize = 12;
    drawSquareOutline(next.page, MARGIN, boxY, boxSize);
    if (field.hint) {
      const hintLines = wrapText(field.hint, next.regular, FONT.body, CONTENT_WIDTH - 24);
      for (let i = 0; i < hintLines.length; i++) {
        next.page.drawText(hintLines[i]!, {
          x: MARGIN + boxSize + 8,
          y: boxY + i * (FONT.body + 2),
          size: FONT.body,
          font: next.regular,
          color: COLORS.muted,
        });
      }
    }
  } else {
    drawRoundedRect(next.page, MARGIN, boxY, CONTENT_WIDTH, fieldHeight, FIELD_RADIUS, {
      fill: COLORS.fieldFill,
      stroke: COLORS.line,
      strokeWidth: 0.75,
    });

    const placeholder = field.placeholder ?? field.defaultValue;
    if (placeholder && placeholder.trim()) {
      const phLines = wrapText(placeholder.trim(), next.regular, FONT.label, CONTENT_WIDTH - 16);
      const startY =
        field.type === "textarea"
          ? boxY + fieldHeight - TABLE_CELL_PAD_V - FONT.label
          : boxY + (fieldHeight - FONT.label) / 2;
      for (let i = 0; i < Math.min(phLines.length, field.type === "textarea" ? 4 : 1); i++) {
        next.page.drawText(phLines[i]!, {
          x: MARGIN + TABLE_CELL_PAD_H,
          y: startY - i * (FONT.label + 2),
          size: FONT.label,
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
    color: RGB;
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
    productTitle: ctx.productTitle,
    footerLine: ctx.footerLine,
    disclosureNote: ctx.disclosureNote,
    coverPageIndex: ctx.coverPageIndex,
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

function drawAccentRule(ctx: LayoutContext, y: number): void {
  ctx.page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_WIDTH - MARGIN, y },
    thickness: 2,
    color: COLORS.accent,
  });
}

function drawCenteredText(
  page: PDFPage,
  text: string,
  baselineY: number,
  font: PDFFont,
  size: number,
  color: RGB,
): void {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, {
    x: (PAGE_WIDTH - width) / 2,
    y: baselineY,
    size,
    font,
    color,
  });
}

function drawCenteredLines(
  page: PDFPage,
  lines: string[],
  topBaselineY: number,
  font: PDFFont,
  size: number,
  color: RGB,
): void {
  let y = topBaselineY;
  for (const line of lines) {
    const width = font.widthOfTextAtSize(line, size);
    page.drawText(line, {
      x: (PAGE_WIDTH - width) / 2,
      y,
      size,
      font,
      color,
    });
    y -= size + 6;
  }
}

function drawSquareOutline(page: PDFPage, x: number, y: number, size: number): void {
  page.drawRectangle({
    x,
    y,
    width: size,
    height: size,
    borderColor: COLORS.line,
    borderWidth: 1,
  });
}

function drawRoundedRect(
  page: PDFPage,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  options: { fill?: RGB; stroke?: RGB; strokeWidth?: number },
): void {
  const r = Math.min(radius, width / 2, height / 2);
  const k = 0.5522847498 * r;
  const x2 = x + width;
  const y2 = y + height;

  const ops = [
    pushGraphicsState(),
    moveTo(x + r, y),
    lineTo(x2 - r, y),
    appendBezierCurve(x2 - r + k, y, x2, y + r - k, x2, y + r),
    lineTo(x2, y2 - r),
    appendBezierCurve(x2, y2 - r + k, x2 - r + k, y2, x2 - r, y2),
    lineTo(x + r, y2),
    appendBezierCurve(x + r - k, y2, x, y2 - r + k, x, y2 - r),
    lineTo(x, y + r),
    appendBezierCurve(x, y + r - k, x + r - k, y, x + r, y),
    closePath(),
  ];

  if (options.fill) {
    page.pushOperators(
      ...ops,
      setFillingRgbColor(options.fill.red, options.fill.green, options.fill.blue),
      fill(),
      popGraphicsState(),
    );
    if (options.stroke) {
      page.pushOperators(
        pushGraphicsState(),
        moveTo(x + r, y),
        lineTo(x2 - r, y),
        appendBezierCurve(x2 - r + k, y, x2, y + r - k, x2, y + r),
        lineTo(x2, y2 - r),
        appendBezierCurve(x2, y2 - r + k, x2 - r + k, y2, x2 - r, y2),
        lineTo(x + r, y2),
        appendBezierCurve(x + r - k, y2, x, y2 - r + k, x, y2 - r),
        lineTo(x, y + r),
        appendBezierCurve(x, y + r - k, x + r - k, y, x + r, y),
        closePath(),
        setStrokingRgbColor(options.stroke.red, options.stroke.green, options.stroke.blue),
        setLineWidth(options.strokeWidth ?? 1),
        stroke(),
        popGraphicsState(),
      );
    }
    return;
  }

  if (options.stroke) {
    page.pushOperators(
      ...ops,
      setStrokingRgbColor(options.stroke.red, options.stroke.green, options.stroke.blue),
      setLineWidth(options.strokeWidth ?? 1),
      stroke(),
      popGraphicsState(),
    );
  }
}

function stampPageNumbersAndFooters(ctx: LayoutContext): void {
  const pages = ctx.pdfDoc.getPages();
  const total = pages.length;
  const lastIndex = total - 1;
  const coverIndex = ctx.coverPageIndex;
  const contentTotal = coverIndex !== undefined ? total - 1 : total;
  let contentPage = 0;

  const footerRuleY = MARGIN + 22;
  const footerTextY = MARGIN + 10;

  for (let i = 0; i < total; i++) {
    if (i === coverIndex) {
      continue;
    }

    contentPage += 1;
    const page = pages[i]!;
    const pageLabel = `Page ${contentPage} of ${contentTotal}`;
    const numWidth = ctx.regular.widthOfTextAtSize(pageLabel, FONT.footer);

    page.drawLine({
      start: { x: MARGIN, y: footerRuleY },
      end: { x: PAGE_WIDTH - MARGIN, y: footerRuleY },
      thickness: 0.5,
      color: COLORS.line,
    });

    page.drawText(truncate(ctx.productTitle, 72), {
      x: MARGIN,
      y: footerTextY,
      size: FONT.footer,
      font: ctx.regular,
      color: COLORS.muted,
    });

    page.drawText(pageLabel, {
      x: PAGE_WIDTH - MARGIN - numWidth,
      y: footerTextY,
      size: FONT.footer,
      font: ctx.regular,
      color: COLORS.muted,
    });

    if (i === lastIndex && ctx.disclosureNote) {
      const note = ctx.disclosureNote;
      const lines = wrapText(note, ctx.regular, FONT.footer, CONTENT_WIDTH);
      let y = footerRuleY + 10;
      for (const line of lines.slice(-3)) {
        page.drawText(line, {
          x: MARGIN,
          y,
          size: FONT.footer,
          font: ctx.regular,
          color: COLORS.muted,
        });
        y += FONT.footer + 3;
      }
    }
  }
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}
