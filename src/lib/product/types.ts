/** Printable field kinds for utility-first worksheets and planners. */
export type ProductFieldType =
  | "text"
  | "textarea"
  | "checkbox"
  | "number"
  | "date";

/** Single fillable or printable control on a page. */
export interface ProductField {
  id: string;
  label: string;
  type: ProductFieldType;
  placeholder?: string;
  defaultValue?: string;
  hint?: string;
}

/** Group of related fields under an optional heading. */
export interface ProductSection {
  id: string;
  title?: string;
  description?: string;
  fields: ProductField[];
}

/** One printable page in a multi-page product. */
export interface ProductPage {
  id: string;
  title: string;
  sections: ProductSection[];
}

/** Structured printable product passed to the PDF generator. */
export interface ProductDocument {
  title: string;
  subtitle?: string;
  format?: string;
  audience?: string;
  pages: ProductPage[];
  footerNote?: string;
}
