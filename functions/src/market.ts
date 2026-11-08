// Market-close composition for the push sender. This is a COPY of
// the core of app/src/market.ts - the app and the functions deploy
// separately, so the module is duplicated deliberately; keep the
// two in sync (the format was owner-approved 2026-11-07 and is
// covered by the app-side proof against E*TRADE's own figures).
export const ALERT_THRESHOLD_PCT = 4;

export interface Quote {
  price: number;
  changePct: number;
}

export interface PositionQty {
  ticker: string;
  quantity: number;
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
