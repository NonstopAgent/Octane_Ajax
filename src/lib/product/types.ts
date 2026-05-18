/** Printable field kinds for utility-first worksheets and planners. */
export type ProductFieldType =
  | "text"
  | "textarea"
  | "checkbox"
  | "number"
  | "date";

/** Role of a printable page in a sellable utility product. */
export type ProductPageKind =
  | "cover"
  | "intro"
  | "worksheet"
  | "summary"
  | "content";

/** Single fillable or printable control on a page. */
export interface ProductField {
  id: string;
  label: string;
  type: ProductFieldType;
  placeholder?: string;
  defaultValue?: string;
  hint?: string;
}

/** Grid / table block for trackers and logs. */
export interface ProductTableBlock {
  id: string;
  headers: string[];
  /** Each row is a list of cell values (empty string = blank cell). */
  rows: string[][];
}

/** Checkbox list without per-item field ids. */
export interface ProductChecklistBlock {
  id: string;
  title?: string;
  items: string[];
}

/** Group of related fields under an optional heading. */
export interface ProductSection {
  id: string;
  title?: string;
  description?: string;
  fields: ProductField[];
  table?: ProductTableBlock;
  checklist?: ProductChecklistBlock;
  /** Number of ruled lines to draw when no fields are present. */
  linedLines?: number;
}

/** One printable page in a multi-page product. */
export interface ProductPage {
  id: string;
  kind?: ProductPageKind;
  title: string;
  purpose?: string;
  userInstructions?: string;
  sections: ProductSection[];
}

/** Structured printable product passed to the PDF generator. */
export interface ProductDocument {
  title: string;
  subtitle?: string;
  format?: string;
  audience?: string;
  pages: ProductPage[];
  /** Shown once on the final PDF page (e.g. compliance / AI disclosure). */
  disclosureNote?: string;
  /** Optional per-page footer line (brand, format hint) — not the AI disclosure. */
  footerLine?: string;
  /** @deprecated Use disclosureNote — kept for backwards compat in tests. */
  footerNote?: string;
}
