// Turn OCR/PDF/plain text into label-value pairs the extractor
// understands - PURE module (no native imports) so the exact shipped
// code can be exercised in tests. Handles "Label: value",
// "Label value" and label-line/value-line layouts.
import type { RawField } from "../engine/extract.ts";

/** Round 56 (device QA defect 3): the empty-read test. A reading is
 * EMPTY when the text carries fewer than EMPTY_READ_MIN_ALNUM
 * alphanumeric characters. The threshold: classification needs
 * several anchor tokens and any real document page - even a sparse
 * form - yields hundreds of alphanumeric characters; 40 characters
 * is roughly one short line, so below it there is provably nothing
 * to classify or fill. An empty read is an extraction failure, not
 * a classification outcome, and the confirm card must say so. */
export const EMPTY_READ_MIN_ALNUM = 40;

export function alnumCount(text: string): number {
  return (text.match(/[0-9A-Za-z]/g) ?? []).length;
}

export function isEmptyRead(text: string): boolean {
  return alnumCount(text) < EMPTY_READ_MIN_ALNUM;
}

/** Turn OCR/plain text into label-value pairs the extractor understands.
 * Handles "Label: value", "Label value" and label-line/value-line layouts. */
export function textToRawFields(text: string, confidence = 0.9): RawField[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const fields: RawField[] = [];
  const moneyish = /[$\d][\d,]*\.?\d*/;
  // A bare value line must look like real money (comma, decimal point,
  // $ or parentheses) - otherwise form line numbers ("4", "34") get
  // paired as values. Device rehearsal on a real 8879/1040, 2026-11-07.
  const bareMoney = /^\(?-?\$?[\d][\d,]*(\.\d*)?\)?\.?$/;
  const moneyStrong = (s: string) => bareMoney.test(s) && /[,.$()]/.test(s);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const colon = line.indexOf(":");
    if (colon > 0) {
      const after = line.slice(colon + 1).trim();
      // OCR often splits "Label:" from its figure onto the next line
      // (real E*TRADE screenshot: "Net Account Value :" then
      // "$91,990.34"). An empty colon value takes the next line when
      // it is a bare money figure, and consumes it - otherwise the
      // figure pairs with whatever label follows it instead.
      if (!after && i + 1 < lines.length && moneyStrong(lines[i + 1])) {
        fields.push({ key: line.slice(0, colon), value: lines[i + 1], confidence });
        i++;
        continue;
      }
      fields.push({ key: line.slice(0, colon), value: after, confidence });
      continue;
    }
    const m = line.match(/^(.*?)(\$?\(?-?[\d][\d,]*\.?\d*\)?)$/);
    if (m && m[1].trim().length >= 2 && /[A-Za-z]/.test(m[1])) {
      let key = m[1].trim();
      let value = m[2];
      // Two-column summary tables ("TOTAL BEGINNING VALUE $194,466.60
      // $68,124.76" = this period | year-to-date): the end-anchored
      // match swallows the FIRST amount into the label and pairs the
      // second. The first amount is the primary one - re-split at it.
      // Real E*TRADE statement rehearsal, 2026-11-07.
      const embedded = key.match(/^(.*?)\s+(\(?-?\$[\d,]+(?:\.\d+)?\)?|\(?-?[\d,]+\.\d+\)?)$/);
      if (embedded && embedded[1].trim().length >= 2 && /[A-Za-z]/.test(embedded[1])) {
        key = embedded[1].trim();
        value = embedded[2];
      }
      fields.push({ key, value, confidence });
      continue;
    }
    // Value-ABOVE-label: form layouts (8879 Part I, 1040) reconstruct
    // with the figure on the line above its label. The next line must
    // be a real label: letters, and not itself carrying a trailing
    // figure (those pair on their own line when their turn comes).
    const next = lines[i + 1] ?? "";
    if (moneyStrong(line) && /[A-Za-z]/.test(next) && !/[\d][\d,]*\.?\d*\)?\.?$/.test(next)) {
      fields.push({ key: next, value: line, confidence });
      i++;
      continue;
    }
    if (!moneyish.test(line) && i + 1 < lines.length && moneyStrong(lines[i + 1])) {
      fields.push({ key: line, value: lines[i + 1], confidence });
      i++;
    }
  }
  return fields;
}

