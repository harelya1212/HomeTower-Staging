// Structure-aware payslip row parser (pure module - no imports beyond
// the RawField type, so Node can execute the shipped code directly).
//
// Why this exists (real-file rehearsal, 2026-11-08): a Workday payslip
// prints every figure in Description | Amount | YTD table rows. The
// generic line pairing in textFields.ts anchors the value at the END
// of the line, so it can only ever see the YTD column, and the v1.7
// field map used generic phrasing ("federal income tax") that HR
// systems never print ("Federal Withholding"). Measured baseline on
// the owner's real slips: classification strong, extraction ZERO
// fields. This parser reads the table rows directly and emits
// canonical raw fields (current + YTD as separate keys) that the
// v1.8 field map resolves. It runs AHEAD of the generic pairs in
// DocumentsScreen, so its figures win; the user still confirms every
// reading before anything is saved.
//
// Workday rule the parser relies on: when a row has no current-period
// activity, ONLY the YTD figure prints - a single amount on a
// two-column row is therefore the YTD figure, never the current one
// (when current exists, YTD always prints beside it).
import type { RawField } from "../engine/extract.ts";

const MONEY_RE = /\(?-?\$?\d{1,3}(?:,\d{3})+(?:\.\d{2})?\)?|\(?-?\$?\d+\.\d{2}\)?/g;

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function amountsIn(line: string): string[] {
  return line.match(MONEY_RE) ?? [];
}

// [normalized label prefix, current raw key, ytd raw key] - longest
// labels first so "federal withholding taxable wages" beats
// "federal withholding" and the 401k bonus row beats nothing else.
const ROWS: Array<[string, string, string]> = [
  ["federal withholding taxable wages", "federal taxable wages", "ytd federal taxable wages"],
  ["401k bonus and commission deduction", "401k bonus and commission deduction", "ytd 401k bonus and commission deduction"],
  ["employee stock purchase plan", "employee stock purchase plan", "ytd employee stock purchase plan"],
  ["health savings account", "health savings account", "ytd health savings account"],
  ["federal withholding", "federal withholding", "ytd federal withholding"],
  ["401k deduction", "401k deduction", "ytd 401k deduction"],
  ["state tax", "state tax", "ytd state tax"],
];

export interface PayslipParse {
  fields: RawField[];
  // Indexes of text lines this parser fully interpreted. The caller
  // removes them before generic line pairing: a row read here as
  // "YTD only" would otherwise ALSO pair generically (label -> the
  // line-end figure) and invent a current-period value the slip does
  // not show (measured on a real slip: a blank current HSA column
  // came back filled with the YTD figure).
  consumedLines: number[];
}

export function parsePayslipRows(text: string): PayslipParse {
  const whole = norm(text);
  // Gate: page 1 carries "gross pay / pay period"; page 2 of the same
  // slip carries neither - it is identified by the running header
  // ("Payslip: Name (id): date") and the Taxable Wages table.
  const looksPayslip = whole.includes("payslip")
    && (whole.includes("gross pay") || whole.includes("pay period") || whole.includes("taxable wages") || /payslip:\s*.+\(\d+\)/.test(text));
  if (!looksPayslip) return { fields: [], consumedLines: [] };
  const out: RawField[] = [];
  const consumed: number[] = [];
  const seen = new Set<string>();
  const push = (key: string, value: string) => {
    if (seen.has(key) || value === "") return;
    seen.add(key);
    out.push({ key, value, confidence: 0.9 });
  };

  // Identity from the running header: "Payslip: Jane Doe (1234567): 10/31/2026".
  const hdr = text.match(/payslip:\s*(.+?)\s*\(\d+\)\s*:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
  if (hdr) {
    push("employee name", hdr[1].trim());
    push("pay period end", hdr[2]);
  }

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const n = norm(line);
    if (!n) continue;

    // Payslip Information row: "Jane Doe 1234567 10/16/2026 10/31/2026 10/30/2026"
    // (name, employee id, period begin, period end, check date).
    const info = line.match(/^([A-Za-z][A-Za-z .'-]+?)\s+(\d{5,8})\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}\/\d{1,2}\/\d{4})\s*$/);
    if (info) {
      push("employee name", info[1].trim());
      push("pay period end", info[4]);
      push("check date", info[5]);
      consumed.push(i);
      continue;
    }

    // Current / YTD totals rows (Workday "Current and YTD Totals"
    // table): "Current 86.666667 9,170.90 1,251.45 3,649.28 929.09 3,341.08"
    // columns are Hours | Gross | PreTax | Taxes | PostTax | Net.
    // Gated on the table header appearing just above, so stray lines
    // starting with "current" elsewhere never fire this.
    if ((n.startsWith("current ") || n.startsWith("ytd ")) && i > 0) {
      const above = lines.slice(Math.max(0, i - 4), i).map(norm).join(" ");
      if (above.includes("gross pay") && above.includes("net pay")) {
        const toks = line.trim().split(/\s+/).slice(1)
          .map((t) => t.replace(/[$,()]/g, ""))
          .filter((t) => /^-?\d+(\.\d+)?$/.test(t));
        if (toks.length >= 6) {
          const isYtd = n.startsWith("ytd ");
          push(isYtd ? "ytd gross pay" : "gross pay", toks[1]);
          push(isYtd ? "ytd net pay" : "net pay", toks[5]);
          consumed.push(i);
        }
        continue;
      }
    }

    // Additional withholding election (Withholding table: the two
    // figures are Federal | Work State columns, not Amount | YTD).
    if (n.startsWith("additional withholding")) {
      const m = line.replace(/^.*?additional withholding/i, "").match(/\d[\d,]*/);
      if (m) push("additional withholding", m[0]);
      consumed.push(i);
      continue;
    }

    // Description | Amount | YTD rows. An ESPP refund row is not a
    // contribution - and it must be CONSUMED, not just skipped: left
    // to generic pairing it fuzzy-matches the ESPP label and invents
    // a negative contribution (measured on a real page 2).
    if (n.includes("refund")) {
      if (ROWS.some(([label]) => n.startsWith(label))) consumed.push(i);
      continue;
    }
    for (const [label, curKey, ytdKey] of ROWS) {
      if (!n.startsWith(label)) continue;
      const amts = amountsIn(line);
      if (amts.length >= 2) {
        push(curKey, amts[0]);
        push(ytdKey, amts[amts.length - 1]);
      } else if (amts.length === 1) {
        push(ytdKey, amts[0]); // Workday rule: a lone figure is the YTD column
      }
      if (amts.length >= 1) consumed.push(i);
      break;
    }
  }
  return { fields: out, consumedLines: consumed };
}
