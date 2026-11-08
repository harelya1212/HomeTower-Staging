// Market-close report: composition engine (pure - no I/O).
//
// Owner-approved design (2026-11-07): every trading day, half an
// hour after the US market close (16:30 ET), the user gets a report
// in this exact shape, computed from the holdings THEY last entered
// (documents in the app) plus live closing prices:
//
//   ⚠️ INTC: $56.28, +7.71%
//   VNM: $17.13, +1.84%
//   תיק מוערך היום: כ-+$4,168 על האחזקות (כ-+4.5%), וכ-+3.2% כולל
//   המזומן (הערכה לפי כמויות הבסיס).
//
// Rules: sorted by daily % change, biggest first; ⚠️ marks a move
// of ALERT_THRESHOLD_PCT or more in either direction; unvested plan
// shares are NEVER counted (only the vested balance, converted to
// shares at the plan statement's own last price); a ticker with no
// quote is listed as missing and excluded from the totals - never
// estimated. The same module (copied) runs in the push sender.
import type { DocumentRecord } from "../engine/intake.ts";

export const ALERT_THRESHOLD_PCT = 4;

export interface Quote {
  price: number;
  changePct: number;
}

export interface PositionQty {
  ticker: string;
  quantity: number;
  /** True when the quantity was derived (vested $ / plan price). */
  derived?: boolean;
}

export interface CloseLine {
  ticker: string;
  price: number;
  changePct: number;
  quantity: number;
  dayGain: number;
  alert: boolean;
}

export interface CloseReport {
  lines: CloseLine[];
  missing: string[];
  totalNow: number;
  gainUsd: number;
  pctHoldings: number | null;
  pctWithCash: number | null;
}

export function composeCloseReport(positions: PositionQty[], cash: number | null, quotes: Record<string, Quote>): CloseReport {
  const lines: CloseLine[] = [];
  const missing: string[] = [];
  let totalNow = 0;
  let gainUsd = 0;
  for (const p of positions) {
    const q = quotes[p.ticker];
    if (!q || !(q.price > 0)) {
      missing.push(p.ticker);
      continue;
    }
    const prevClose = q.price / (1 + q.changePct / 100);
    const dayGain = p.quantity * (q.price - prevClose);
    lines.push({ ticker: p.ticker, price: q.price, changePct: q.changePct, quantity: p.quantity, dayGain, alert: Math.abs(q.changePct) >= ALERT_THRESHOLD_PCT });
    totalNow += p.quantity * q.price;
    gainUsd += dayGain;
  }
  lines.sort((a, b) => b.changePct - a.changePct);
  const prevTotal = totalNow - gainUsd;
  const pctHoldings = prevTotal > 0 ? (gainUsd / prevTotal) * 100 : null;
  const pctWithCash = cash !== null && prevTotal + cash > 0 ? (gainUsd / (prevTotal + cash)) * 100 : null;
  return { lines, missing, totalNow, gainUsd, pctHoldings, pctWithCash };
}

function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtSignedPct(pct: number, digits = 2): string {
  return `${pct >= 0 ? "+" : "-"}${Math.abs(pct).toFixed(digits)}%`;
}

/** The push body, in the owner's exact format: one line per holding,
 * then the Hebrew estimate footer. */
export function pushText(report: CloseReport): string {
  const lines = report.lines.map((l) => `${l.alert ? "⚠️ " : ""}${l.ticker}: $${fmtMoney(l.price)}, ${fmtSignedPct(l.changePct)}`);
  const gain = Math.round(report.gainUsd);
  const gainStr = `${gain >= 0 ? "+" : "-"}$${Math.abs(gain).toLocaleString("en-US")}`;
  let footer = `תיק מוערך היום: כ-${gainStr} על האחזקות`;
  if (report.pctHoldings !== null) footer += ` (כ-${fmtSignedPct(report.pctHoldings, 1)})`;
  if (report.pctWithCash !== null) footer += `, וכ-${fmtSignedPct(report.pctWithCash, 1)} כולל המזומן`;
  footer += " (הערכה לפי כמויות הבסיס).";
  return [...lines, "", footer].join("\n");
}

/** The holdings the report runs on, derived from the user's own
 * documents: positions merge by ticker, newest document first (an
 * updated screenshot replaces the older quantity for its tickers);
 * a stock-plan document contributes its VESTED shares (plan_shares,
 * derived at save time from the vested balance and the plan's own
 * last price); cash is the newest brokerage cash figure. */
export function deriveHoldings(documents: DocumentRecord[]): { positions: PositionQty[]; cash: number | null; basisDate: string | null } {
  const sorted = [...documents].sort((a, b) => (b.capturedOn ?? "").localeCompare(a.capturedOn ?? ""));
  const byTicker = new Map<string, PositionQty>();
  let cash: number | null = null;
  let basisDate: string | null = null;
  const note = (d: DocumentRecord) => {
    if (basisDate === null && d.capturedOn) basisDate = d.capturedOn;
  };
  for (const d of sorted) {
    if (d.status !== "parsed") continue;
    if (d.holdings && d.holdings.length > 0) {
      note(d);
      for (const h of d.holdings) {
        if (!byTicker.has(h.ticker)) byTicker.set(h.ticker, { ticker: h.ticker, quantity: h.quantity });
      }
    }
    const f = d.fields ?? {};
    const ticker = typeof f["account_ticker"] === "string" ? f["account_ticker"] : null;
    const shares = Number(f["plan_shares"]);
    if (ticker && Number.isFinite(shares) && shares > 0 && !byTicker.has(ticker)) {
      note(d);
      byTicker.set(ticker, { ticker, quantity: shares, derived: true });
    }
    if (cash === null) {
      const c = Number(f["cash_balance"]);
      if (Number.isFinite(c) && c >= 0) {
        cash = c;
        note(d);
      }
    }
  }
  return { positions: [...byTicker.values()], cash, basisDate };
}
