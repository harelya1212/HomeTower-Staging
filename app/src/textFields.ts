// Turn OCR/PDF/plain text into label-value pairs the extractor
// understands - PURE module (no native imports) so the exact shipped
// code can be exercised in tests. Handles "Label: value",
// "Label value" and label-line/value-line layouts.
import type { RawField } from "../engine/extract.ts";

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
      fields.push({ key: line.slice(0, colon), value: line.slice(colon + 1).trim(), confidence });
      continue;
    }
    const m = line.match(/^(.*?)(\$?\(?-?[\d][\d,]*\.?\d*\)?)$/);
    if (m && m[1].trim().length >= 2 && /[A-Za-z]/.test(m[1])) {
      fields.push({ key: m[1].trim(), value: m[2], confidence });
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

