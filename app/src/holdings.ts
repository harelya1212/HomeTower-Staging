// Holdings parser for brokerage APP SCREENSHOTS - PURE module (no
// native imports), exercised directly in tests against real captures.
//
// Why: a monthly statement gives account totals (ending balance) but
// no per-position detail. The broker's own app shows each position as
// a repeating block - "TICKER - COMPANY NAME" then Last Price / Price
// Paid / Quantity / gains - which is exactly the input concentration
// (SPEC45 sec. 27) and the TaxImpact sale tool need: quantity, basis
// per share (Price Paid) and current price. The layout is regular
// enough to parse deterministically from OCR text; anything partial
// (a block cut off by scrolling) is dropped, never guessed.
import type { Holding } from "../engine/intake.ts";

export interface HoldingsParse {
  positions: Holding[];
  cash: number | null;
}

export interface PlanAccount {
  ticker: string;
  company: string | null;
}

/** A stock-plan overview names its security OUTSIDE the position
 * blocks: an all-caps company line ending in "(TICKER)" ("INTEL CORP
 * COM (INTC)"), or the account header "Stock Plan (INTC) -8978".
 * Amounts alone do not tell the user WHICH stock a plan document is
 * about (owner QA round 27), so the identity is parsed explicitly.
 * Mixed-case plan furniture ("Employee Stock Purchase Plan (ESPP)",
 * "Restricted Stock (RS)") must never match. */
export function parsePlanAccount(text: string): PlanAccount | null {
  const lines = text.split("\n").map((l) => l.trim());
  for (const line of lines) {
    const m = line.match(/^([A-Z][A-Z0-9 .,&'()-]*?)\s*\(([A-Z]{1,5})\)$/);
    if (m && m[1].trim().length >= 4 && !/^(LAST|TOTAL|TODAY)/.test(m[1])) {
      return { ticker: m[2], company: m[1].trim() };
    }
  }
  for (const line of lines) {
    const m = line.match(/stock plan\s*\(([A-Z]{1,5})\)/i);
    if (m) return { ticker: m[1].toUpperCase(), company: null };
  }
  return null;
}

const MONEY_TOKEN = /\(?-?\$?[\d][\d,]*\.?\d*\)?%?/;

function moneyAfter(line: string, fromIndex: number): number | null {
  const m = line.slice(fromIndex).match(MONEY_TOKEN);
  if (!m) return null;
  const cleaned = m[0].replace(/[$,%\s]/g, "");
  const neg = cleaned.startsWith("(") || cleaned.startsWith("-");
  const n = Number(cleaned.replace(/[()]/g, ""));
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

/** Value for a label: rest of the label's own line, else the next
 * non-empty line (OCR flattens the two-column rows both ways). */
function labelledValue(lines: string[], i: number, label: RegExp): number | null {
  const m = lines[i].match(label);
  if (!m) return null;
  const sameLine = moneyAfter(lines[i], (m.index ?? 0) + m[0].length);
  if (sameLine !== null) return sameLine;
  for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
    if (lines[j].trim()) return moneyAfter(lines[j], 0);
  }
  return null;
}

const HEADER = /^([A-Z]{1,5})\s+-\s+(.+)$/;
const LABELS: Array<[keyof Draft, RegExp]> = [
  ["lastPrice", /^last price\b/i],
  ["pricePaid", /^price paid\b/i],
  ["quantity", /^quantity\b/i],
];

interface Draft {
  lastPrice?: number;
  pricePaid?: number;
  quantity?: number;
}

export function parseHoldings(text: string): HoldingsParse {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const positions: Holding[] = [];
  let cash: number | null = null;
  let current: { ticker: string; name: string; draft: Draft } | null = null;

  const flush = () => {
    if (!current) return;
    const { lastPrice, pricePaid, quantity } = current.draft;
    if (lastPrice !== undefined && pricePaid !== undefined && quantity !== undefined && quantity > 0) {
      if (!positions.some((p) => p.ticker === current!.ticker)) {
        positions.push({ ticker: current.ticker, name: current.name, quantity, pricePaid, lastPrice });
      }
    }
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = line.match(HEADER);
    // A block header ends the previous block. Guard against prose
    // lines that merely contain " - ": the name side must look like a
    // company name (letters, no $ or digits-led text) and the block
    // fields must follow - incomplete drafts are dropped at flush.
    if (h && !/\$/.test(h[2]) && /^[A-Za-z]/.test(h[2])) {
      flush();
      current = { ticker: h[1], name: h[2].trim(), draft: {} };
      continue;
    }
    if (current) {
      for (const [key, re] of LABELS) {
        if (re.test(line)) {
          const v = labelledValue(lines, i, re);
          if (v !== null) current.draft[key] = v;
        }
      }
      if (/^total gain\b/i.test(line)) {
        // Last row of a block - the next header (or EOF) flushes it,
        // but a following non-block section should not bleed in.
        const saved = current;
        flush();
        current = null;
        void saved;
      }
      continue;
    }
    if (/^cash$/i.test(line) || /^cash\s/i.test(line)) {
      const v = labelledValue(lines, i, /^cash\b/i);
      if (v !== null && v >= 0) cash = v;
    }
    // Column-interleaved overview header (real tesseract output):
    // "Day's Gain Total Gain Cash" on one line, the three values on
    // the next - Cash is the LAST column, so its value is the last
    // money token of the following line.
    if (cash === null && /\bcash\s*$/i.test(line) && /gain/i.test(line)) {
      const next = lines[i + 1] ?? "";
      const tokens = next.match(/\(?-?\$[\d,]+\.?\d*\)?/g);
      if (tokens && tokens.length >= 2) {
        const v = moneyAfter(tokens[tokens.length - 1], 0);
        if (v !== null && v >= 0) cash = v;
      }
    }
  }
  flush();
  return { positions, cash };
}

/** Market value of one position. */
export function positionValue(p: Holding): number {
  return p.quantity * p.lastPrice;
}

/** Total cost basis of one position. */
export function positionBasis(p: Holding): number {
  return p.quantity * p.pricePaid;
}
