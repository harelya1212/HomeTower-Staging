// Column-aware pairing for form PDFs - PURE module (no pdfjs import),
// exercised directly in tests against real files.
//
// Why: forms like the 1040 print values in a right-hand column whose
// baselines sit ~2pt above their label rows. Line-based reconstruction
// detaches the values from the labels ("Tax and 338,962." next to an
// orphan "adjusted gross income" line), and line pairing then invents
// wrong pairs from schedules. Working at the item level instead: a
// money item in the value column pairs with the text row just below
// it, which is where the form prints its label.
//
// Measured on a real 1040 (client copy, 2026-11-07): values at
// x >= 518 on a 612-wide page, label baseline = value baseline - 2,
// line-number token at the label row's right end.
import type { RawField } from "../engine/extract.ts";

export interface ColumnItem {
  str: string;
  x: number;
  y: number;
  width: number;
}

// A value-column figure: digits with a comma, a $, parentheses, or a
// two-decimal fraction. A bare year ("2025.") deliberately fails.
const MONEY = /^(?:-?\$[\d,]+(?:\.\d+)?|\(?[\d,]+(?:\.\d+)?\)?|\$?\(?-?[\d]+\.\d{2}\)?)\.?$/;

function cleanLabel(s: string): string {
  return s
    .replace(/[^\x20-\x7E]/g, " ") // box/leader glyphs and control chars
    .replace(/~+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\d{1,2}[a-z]?\s+/, "") // leading form line number ("9 Add lines...")
    .replace(/\s+\d{1,2}[a-z]?$/, ""); // trailing line number token ("... total tax 24")
}

function cleanValue(s: string): string {
  // The form prints a trailing period after whole-dollar figures
  // ("338,962.") - it is punctuation, not a decimal point.
  return /[\d,]$/.test(s) && s.endsWith(".") ? s.slice(0, -1) : s;
}

/** Pair value-column money items with their label rows for one page. */
export function columnRawFields(items: ColumnItem[], confidence = 0.95): RawField[] {
  const usable = items.filter((i) => i.str && i.str.trim().length > 0);
  if (usable.length === 0) return [];
  const pageWidth = Math.max(...usable.map((i) => i.x + (i.width || 0)), 612);
  const valueX = pageWidth * 0.78;
  const values = usable
    .filter((i) => i.x >= valueX && MONEY.test(i.str.trim()))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const fields: RawField[] = [];
  for (const v of values) {
    // The label row sits on the value's baseline or up to ~4pt below
    // it (measured: exactly 2pt on the 1040). Items in the value
    // column itself are not label text.
    const row = usable
      .filter((i) => i !== v && i.x < valueX && v.y - i.y >= -1 && v.y - i.y <= 4)
      .sort((a, b) => a.x - b.x);
    if (row.length === 0) continue;
    const label = cleanLabel(row.map((i) => i.str).join(" "));
    if (!/[A-Za-z]{3,}/.test(label)) continue;
    const value = cleanValue(v.str.trim());
    // Forms love "This is your total tax" as the last sentence of a
    // long instruction label - emit that tail as its own key so the
    // extractor's exact matching can find it.
    const sentences = label.split(/\.\s+/);
    const tail = sentences.length > 1 ? sentences[sentences.length - 1] : "";
    const tailKey = tail.replace(/^(this is your|this is|these are your|these are)\s+/i, "").trim();
    if (tailKey.length >= 3 && tailKey.toLowerCase() !== label.toLowerCase()) {
      fields.push({ key: tailKey, value, confidence });
    }
    fields.push({ key: label, value, confidence });
  }
  return fields;
}
