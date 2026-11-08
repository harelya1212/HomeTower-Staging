// Rebuild reading lines from pdf.js text items - PURE module (no
// pdf.js import) so the exact shipped code can be exercised in tests.
//
// Why this exists (device QA, 2026-11-07): joining items with a space
// whenever the Y coordinate changed produced text like
// "Adjusted  gross  income" - pdf.js splits words into fragments and
// the naive joiner inserted spaces inside words, so NO label, keyword
// or anchor ever matched and a Form 8879 packet classified as
// "unknown". Geometry is the truth: items are grouped into lines by
// baseline, ordered left-to-right, and a space is inserted only when
// the horizontal gap is a real word gap (a fraction of the font size).
export interface TextItemLike {
  str: string;
  transform?: number[]; // [a, b, c, d, x, y]
  width?: number;
  height?: number;
  hasEOL?: boolean;
}

export function itemsToLines(items: TextItemLike[]): string[] {
  interface Placed { str: string; x: number; y: number; end: number; size: number; hasEOL: boolean }
  const placed: Placed[] = [];
  for (const item of items) {
    if (!item.str) continue;
    const t = item.transform ?? [0, 0, 0, 0, 0, 0];
    const size = Math.hypot(t[2] ?? 0, t[3] ?? 0) || item.height || 10;
    placed.push({
      str: item.str,
      x: t[4] ?? 0,
      y: t[5] ?? 0,
      end: (t[4] ?? 0) + (item.width ?? 0),
      size,
      hasEOL: !!item.hasEOL,
    });
  }
  // PDF coordinates: larger Y is HIGHER on the page - read top first.
  placed.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: string[] = [];
  let current: Placed[] = [];
  let lineY: number | null = null;
  const flush = () => {
    if (!current.length) return;
    current.sort((a, b) => a.x - b.x);
    let out = "";
    let prev: Placed | null = null;
    for (const p of current) {
      if (prev) {
        const gap = p.x - prev.end;
        if (gap > prev.size * 0.3 && !out.endsWith(" ") && !p.str.startsWith(" ")) out += " ";
      }
      out += p.str;
      prev = p;
    }
    const trimmed = out.trim();
    if (trimmed) lines.push(trimmed);
    current = [];
  };
  for (const p of placed) {
    if (lineY === null || Math.abs(p.y - lineY) <= 2) {
      current.push(p);
      if (lineY === null) lineY = p.y;
    } else {
      flush();
      current = [p];
      lineY = p.y;
    }
    if (p.hasEOL) {
      flush();
      lineY = null;
    }
  }
  flush();
  return lines;
}
