// Bank / card statement CSV import (round 48).
//
// A statement export is spending EVIDENCE: this module turns it into
// annualized outflows per Retirement Lifestyle category (keys from
// goals.ts LIFESTYLE_CATEGORIES). The numbers prefill the Lifestyle
// page - only into categories the user has not filled - and the
// user confirms the resulting target there. Nothing here writes to
// the store.
//
// Column handling is deliberately conservative: a file is read only
// when a date column, a description column and an amount source
// (a signed Amount, a Debit/Credit pair, or a Type column) are all
// found. Outflow convention: negative Amount = money out (the
// common bank and Chase-style card convention); with Debit/Credit
// columns, money out = Debit minus Credit. A card export whose
// amounts are ALL positive (Amex-style) treats positives as charges,
// minus rows whose description says they are payments.

export interface CsvSpending {
  months: number; // calendar months touched by the file's dates
  byCategory: Record<string, number>; // annualized $/yr per lifestyle category key
  totalOutflowAnnual: number; // annualized total outflow
  transactions: number; // outflow rows counted
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

function parseAmount(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  let s = raw.trim().replace(/[$,\s]/g, "");
  if (s === "" || s === "-") return null;
  let neg = false;
  if (s.startsWith("(") && s.endsWith(")")) { neg = true; s = s.slice(1, -1); }
  if (s.endsWith("-")) { neg = true; s = s.slice(0, -1); }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -Math.abs(n) : n;
}

/** Parse a statement date to [year, month] - only the year/month is
 * needed (months spanned), which sidesteps day-format ambiguity. */
function parseYearMonth(raw: string | undefined): [number, number] | null {
  if (!raw) return null;
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return [Number(m[1]), Number(m[2])];
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return [Number(m[3]), Number(m[1])];
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2})\b/.exec(s);
  if (m) return [2000 + Number(m[3]), Number(m[1])];
  return null;
}

// Category keyword rules, first match wins - specific before
// generic (property tax before taxes, airlines before generic
// transport). Big-box and marketplace names (Amazon, Walmart,
// Target, Costco) stay "other": a statement line there can be
// anything, and inventing a category would be inventing data.
const CATEGORY_RULES: Array<{ key: string; words: string[] }> = [
  { key: "property_tax_hoa", words: ["property tax", "prop tax", "hoa", "homeowners association", "tax collector"] },
  { key: "housing", words: ["rent", "mortgage", "mtg pymt", "mtg payment", "landlord"] },
  { key: "utilities", words: ["electric", "power & light", "water dept", "water bill", "sewer", "natural gas", "utility", "utilities", "internet", "broadband", "verizon", "at&t", "t-mobile", "tmobile", "xfinity", "comcast", "cox comm"] },
  { key: "insurance", words: ["insurance", "geico", "state farm", "allstate", "progressive", "usaa", "premium"] },
  { key: "healthcare", words: ["pharmacy", "cvs", "walgreens", "rite aid", "clinic", "hospital", "dental", "dentist", "medical", "doctor", "optical", "vision"] },
  { key: "travel", words: ["airlines", "air lines", "airways", "southwest air", "delta air", "united air", "american air", "hotel", "marriott", "hilton", "hyatt", "airbnb", "vrbo", "expedia", "booking.com", "hertz", "avis", "enterprise rent"] },
  { key: "transportation", words: ["shell", "chevron", "exxon", "mobil", "arco", "fuel", "gas station", "uber", "lyft", "parking", "transit", "auto repair", "oil change", "tire", "jiffy"] },
  { key: "food", words: ["grocery", "safeway", "kroger", "albertsons", "trader joe", "whole foods", "sprouts", "publix", "h-e-b", "heb ", "market basket", "restaurant", "mcdonald", "starbucks", "chipotle", "doordash", "grubhub", "uber eats", "cafe", "coffee", "pizza", "bakery"] },
  { key: "entertainment", words: ["netflix", "hulu", "spotify", "hbo", "cinema", "theater", "theatre", "ticketmaster", "steam", "playstation", "xbox"] },
  { key: "home_maintenance", words: ["home depot", "lowe's", "lowes", "hardware", "lawn", "pest", "plumbing", "hvac", "handyman", "landscap"] },
  { key: "personal", words: ["salon", "barber", "gym", "fitness", "nike", "apparel", "clothing", "beauty", "spa"] },
  { key: "taxes_retirement", words: ["irs", "us treasury", "state tax", "dept of revenue", "department of revenue", "estimated tax", "income tax"] },
];

function categorize(description: string): string {
  const d = ` ${description.toLowerCase()} `;
  for (const rule of CATEGORY_RULES) {
    if (rule.words.some((w) => d.includes(w))) return rule.key;
  }
  return "other";
}

const PAYMENT_WORDS = ["payment", "autopay", "thank you", "online pmt", "bill pay credit"];

export function parseSpendingCsv(text: string, kind: "bank" | "card"): CsvSpending | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return null;
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim());
  const findCol = (names: string[]) => header.findIndex((h) => names.includes(h));
  const dateCol = findCol(["date", "transaction date", "posting date", "post date", "posted date", "trans date"]);
  const descCol = findCol(["description", "name", "memo", "details", "payee", "narrative", "transaction description"]);
  const amountCol = findCol(["amount", "transaction amount", "value"]);
  const debitCol = findCol(["debit", "debits", "withdrawal", "withdrawals", "money out"]);
  const creditCol = findCol(["credit", "credits", "deposit", "deposits", "money in"]);
  const typeCol = findCol(["type", "transaction type", "debit credit"]);
  if (dateCol < 0 || descCol < 0 || (amountCol < 0 && debitCol < 0)) return null;

  interface Row { ym: [number, number]; desc: string; outflow: number }
  const rows: Row[] = [];
  let anyNegative = false;
  const rawRows: Array<{ ym: [number, number]; desc: string; amount: number | null; debit: number | null; credit: number | null; type: string }> = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const ym = parseYearMonth(cells[dateCol]);
    if (!ym || ym[1] < 1 || ym[1] > 12) continue;
    const desc = cells[descCol] ?? "";
    const amount = amountCol >= 0 ? parseAmount(cells[amountCol]) : null;
    const debit = debitCol >= 0 ? parseAmount(cells[debitCol]) : null;
    const credit = creditCol >= 0 ? parseAmount(cells[creditCol]) : null;
    const type = typeCol >= 0 ? (cells[typeCol] ?? "").toLowerCase() : "";
    if (amount !== null && amount < 0) anyNegative = true;
    rawRows.push({ ym, desc, amount, debit, credit, type });
  }
  if (rawRows.length === 0) return null;

  for (const r of rawRows) {
    let outflow: number | null = null;
    if (r.debit !== null || r.credit !== null) {
      const net = Math.abs(r.debit ?? 0) - Math.abs(r.credit ?? 0);
      if (net > 0) outflow = net;
    } else if (r.type) {
      if (r.type.includes("debit") && r.amount !== null && r.amount !== 0) outflow = Math.abs(r.amount);
    } else if (r.amount !== null && r.amount !== 0) {
      if (anyNegative) {
        if (r.amount < 0) outflow = -r.amount;
      } else if (kind === "card") {
        const d = r.desc.toLowerCase();
        if (!PAYMENT_WORDS.some((w) => d.includes(w))) outflow = r.amount;
      }
    }
    if (outflow !== null && outflow > 0) rows.push({ ym: r.ym, desc: r.desc, outflow });
  }
  if (rows.length === 0) return null;

  const idx = ([y, m]: [number, number]) => y * 12 + (m - 1);
  const lo = Math.min(...rows.map((r) => idx(r.ym)));
  const hi = Math.max(...rows.map((r) => idx(r.ym)));
  const months = Math.max(1, hi - lo + 1);
  const factor = 12 / months;
  const byCategory: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    const key = categorize(r.desc);
    byCategory[key] = (byCategory[key] ?? 0) + r.outflow * factor;
    total += r.outflow * factor;
  }
  for (const k of Object.keys(byCategory)) byCategory[k] = Math.round(byCategory[k]);
  return { months, byCategory, totalOutflowAnnual: Math.round(total), transactions: rows.length };
}
