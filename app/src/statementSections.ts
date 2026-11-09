// Statement structure parsers (round 55) - PURE module, in the
// spirit of payslipRows.ts: the generic label-value pairing cannot
// read custodian statement layouts, so the structure is parsed
// directly and precise figures are emitted as raw fields whose keys
// are labels in the ocr-field-maps pack. Four parsers:
//
// - segmentStatement / parseSectionFields: multi-account statement
//   fan-out (workstream A). A combined statement (several accounts
//   under one cover page) is segmented by its printed account
//   markers; each account's OWN section yields its OWN balance -
//   the document's portfolio total is an aggregate of all accounts
//   and is NEVER an account balance (the $46,959.53 rule).
//   Two-column rows ("This Period | Year-to-Date") resolve to the
//   YTD column for year-to-date facts, exactly like the payslip
//   row parser resolves its Amount | YTD tables.
// - parseSaForm: the HSA tax forms 5498-SA / 1099-SA (workstream
//   E). Box meanings are fixed by the IRS form, so boxes resolve
//   by number; the printed label is not trusted for identity.
// - parse401kDetail: the NetBenefits contribution-summary table,
//   activity-by-fund holdings and future-election lines
//   (workstream F) - multi-amount table rows generic pairing
//   cannot read.
// - parseHsaPageFields: a screenshot-tolerant balance rule for an
//   HSA account page (the balance heading + the figure under it),
//   used only to FILL a balance the generic read missed - measured
//   against real tesseract output of the owner's HSA screenshot,
//   where the contributions panel garbles but the balance figure
//   survives verbatim a line or two under its heading.
// - parseHsaDepositDetail (round 57): the HSA section's own
//   Contributions activity table - the individual dated deposits
//   behind the period total. The period total is a MONTHLY figure
//   (one statement period); a per-payroll figure exists only when
//   the detail itself proves one - a single contribution stream
//   repeating one equal amount that accounts for the whole period
//   total. Anything else (one deposit, unequal amounts, mixed
//   streams, a partial listing) leaves per-payroll UNKNOWN: it is
//   never guessed by dividing or multiplying the period total.
import { extractFields, type ExtractionResult, type RawField } from "../engine/extract.ts";
import { textToRawFields } from "./textFields.ts";

const MONEY_RE = /\(?-?\$?\d{1,3}(?:,\d{3})+(?:\.\d{2})?\)?|\(?-?\$?\d+\.\d{2}\)?/g;

function amountsIn(line: string): number[] {
  return (line.match(MONEY_RE) ?? []).map((s) => Number(s.replace(/[$,()]/g, ""))).filter((n) => Number.isFinite(n));
}

function bareMoney(line: string): number | null {
  const m = line.trim().match(/^\(?-?\$?([\d,]+\.\d{2})\)?$/);
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export interface StatementPeriod { startIso: string; endIso: string; months: number }

/** The statement's own period, from its printed header ("October 1,
 * 2026 - October 31, 2026") or its Statement Period line. Months use
 * the same 30.4375-day divisor as goals.statementPeriodMonths, so a
 * period derived here and a period derived there agree. */
export function statementPeriodOf(text: string): StatementPeriod | null {
  const days = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
  const finish = (startIso: string, endIso: string): StatementPeriod => ({
    startIso, endIso, months: Math.max(1, Math.round(days(startIso, endIso) / 30.4375)),
  });
  const named = text.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\s*-\s*(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})/i);
  if (named) {
    return finish(
      iso(Number(named[3]), MONTHS[named[1].toLowerCase()], Number(named[2])),
      iso(Number(named[6]), MONTHS[named[4].toLowerCase()], Number(named[5])),
    );
  }
  const sp = text.match(/statement period:?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(?:to|-|–)\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  if (sp) {
    return finish(iso(Number(sp[3]), Number(sp[1]), Number(sp[2])), iso(Number(sp[6]), Number(sp[4]), Number(sp[5])));
  }
  return null;
}

/** The document's combined portfolio total, when it prints one.
 * An AGGREGATE of every account in the document: surfaced on the
 * confirm card so the user sees it was seen, and used by the tests
 * to prove it is stored as NO account's balance. */
export function portfolioTotalOf(text: string): number | null {
  for (const line of text.split(/\r?\n/)) {
    if (/ending portfolio value/i.test(line)) {
      const a = amountsIn(line);
      if (a.length) return a[0];
    }
  }
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/your portfolio value:/i.test(lines[i])) {
      for (let j = i; j <= Math.min(i + 2, lines.length - 1); j++) {
        const v = bareMoney(lines[j]) ?? amountsIn(lines[j])[0];
        if (v !== undefined && v !== null) return v;
      }
    }
  }
  return null;
}

export type SectionKind = "529" | "hsa";

export interface StatementSection {
  kind: SectionKind;
  docType: string; // 529_statement | hsa_statement
  accountId: string | null;
  /** The person the section names: the beneficiary (529) or the
   * account owner (HSA), exactly as printed. */
  personName: string | null;
  text: string;
}

/** Segment a custodian statement into per-account sections. A
 * section opens at an "Account Value:" line (the account's own
 * summary block) under the account number in effect there - the
 * number prints on the Account Value line itself or on the Account
 * # lines above it - and runs until the next account's summary.
 * The cover / portfolio-summary pages before the first section are
 * NOT a section: they hold aggregates and the account index, never
 * an account's own facts. Kind and person come from the section's
 * own identity lines ("NAME - BENEFICIARY (529)", "NAME - HEALTH
 * SAVINGS ACCOUNT"). Sections whose identity cannot be resolved
 * are dropped - an unidentified account is never guessed into a
 * household member's record. */
export function segmentStatement(text: string): StatementSection[] {
  const lines = text.split(/\r?\n/);
  interface Open { accountId: string | null; valueIdx: number }
  const opens: Open[] = [];
  let currentAccount: string | null = null;
  const seenAccounts = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const acct = lines[i].match(/Account #\s*([\d][\d-]*)/);
    if (acct) currentAccount = acct[1];
    if (/^\s*Account Value:/.test(lines[i])) {
      const onLine = lines[i].match(/Account #\s*([\d][\d-]*)/);
      const id = onLine ? onLine[1] : currentAccount;
      if (id && !seenAccounts.has(id)) {
        seenAccounts.add(id);
        opens.push({ accountId: id, valueIdx: i });
      }
    }
  }
  // Sections partition the document just above each Account
  // Value line: everything from there to just above the next
  // account's value line is that account's own block, so a
  // neighbour's rows can never bleed into a reading however close
  // together the sections print. The identity line itself sits in
  // the value line's immediate neighbourhood - below it on the
  // 529 blocks of the measured statement, above it on the HSA
  // block - so the name is resolved in a small window around the
  // value line, never by scanning the whole span (a previous
  // account's name repeats on its own detail pages).
  const sections: StatementSection[] = [];
  for (let s = 0; s < opens.length; s++) {
    const vIdx = opens[s].valueIdx;
    const start = Math.max(0, vIdx - 2);
    const end = s + 1 < opens.length ? Math.max(opens[s + 1].valueIdx - 2, vIdx + 1) : lines.length;
    const span = lines.slice(start, end).join("\n");
    const winText = lines.slice(Math.max(0, vIdx - 4), Math.min(end, vIdx + 8)).join("\n");
    const bene = winText.match(/^(.+?)\s*-\s*BENEFICIARY\s*\(529\)/im) ?? span.match(/^(.+?)\s*-\s*BENEFICIARY\s*\(529\)/im);
    const hsa = winText.match(/^(.+?)\s*-\s*HEALTH SAVINGS ACCOUNT/im) ?? span.match(/^(.+?)\s*-\s*HEALTH SAVINGS ACCOUNT/im);
    if (bene) {
      sections.push({ kind: "529", docType: "529_statement", accountId: opens[s].accountId, personName: bene[1].trim().replace(/\s+/g, " "), text: span });
    } else if (hsa) {
      sections.push({ kind: "hsa", docType: "hsa_statement", accountId: opens[s].accountId, personName: hsa[1].trim().replace(/\s+/g, " "), text: span });
    }
  }
  return sections;
}

export interface HsaDeposit { date: string; amount: number; description: string }
export interface HsaDepositDetail { deposits: HsaDeposit[]; perPayroll: number | null }

/** The HSA section's Contributions activity table: the dated
 * deposit lines behind the period total ("10/14 Participant Cur
 * Yr $44.65"). The block opens at the bare "Contributions"
 * activity heading (the summary rows never print the word alone)
 * and closes at its "Total Contributions" line. Deposit dates
 * print as M/D; the year is resolved against the statement's own
 * period when the section carries one (the custodian repeats the
 * period header on the section's own pages), and stays as printed
 * when it does not. perPayroll is derived ONLY from detail that
 * proves it: at least two deposits, all one description (a single
 * contribution stream), all the same amount, and - when a period
 * total is known from the summary row or the block's own total
 * line - the deposits account for all of it. */
export function parseHsaDepositDetail(text: string, periodTotal: number | null): HsaDepositDetail {
  const lines = text.split(/\r?\n/);
  const period = statementPeriodOf(text);
  const dateFor = (m: number, d: number): string => {
    if (period) {
      const years = [...new Set([Number(period.startIso.slice(0, 4)), Number(period.endIso.slice(0, 4))])];
      for (const y of years) {
        const c = iso(y, m, d);
        if (c >= period.startIso && c <= period.endIso) return c;
      }
      return iso(Number(period.endIso.slice(0, 4)), m, d);
    }
    return `${m}/${d}`;
  };
  const deposits: HsaDeposit[] = [];
  let blockTotal: number | null = null;
  const start = lines.findIndex((l) => l.trim().toLowerCase() === "contributions");
  if (start >= 0) {
    for (let i = start + 1; i < Math.min(start + 42, lines.length); i++) {
      const line = lines[i].trim();
      const total = line.match(/^total contributions\s+\$?([\d,]+\.\d{2})$/i);
      if (total) { blockTotal = Number(total[1].replace(/,/g, "")); break; }
      if (/^date\b/i.test(line) && /amount/i.test(line)) continue;
      const e = line.match(/^(\d{1,2})\/(\d{1,2})\s+(.+?)\s+\$?(-?[\d,]+\.\d{2})$/);
      if (e) {
        deposits.push({ date: dateFor(Number(e[1]), Number(e[2])), amount: Number(e[4].replace(/,/g, "")), description: e[3].trim().replace(/\s+/g, " ") });
        continue;
      }
      if (deposits.length) break;
    }
  }
  let perPayroll: number | null = null;
  if (deposits.length >= 2) {
    const first = deposits[0];
    const oneStream = deposits.every((d) => d.amount === first.amount
      && d.description.toLowerCase() === first.description.toLowerCase());
    const sum = Math.round(deposits.reduce((s, d) => s + d.amount, 0) * 100) / 100;
    const checkTotal = blockTotal ?? periodTotal;
    if (oneStream && first.amount > 0 && (checkTotal === null || Math.abs(sum - checkTotal) < 0.01)) {
      perPayroll = first.amount;
    }
  }
  return { deposits, perPayroll };
}

/** The flat field strings a saved HSA section record carries for
 * its deposit detail (round 57) - the analogue of k401DetailFields,
 * shared by the fan-out save path and the reprocess pass so both
 * write the identical shape. The deposits persist whenever the
 * statement prints them; per_payroll_contribution rides the field
 * maps as a number (emitted by parseSectionFields) and is NOT
 * repeated here. */
export function hsaDepositFields(section: StatementSection): Record<string, string> {
  if (section.kind !== "hsa") return {};
  const detail = parseHsaDepositDetail(section.text, null);
  if (!detail.deposits.length) return {};
  return { deposit_detail: JSON.stringify(detail.deposits) };
}

/** One account section's facts, YTD-aware. Emits raw fields under
 * the section-parser labels of the ocr-field-maps pack, so the
 * figures resolve through extractFields like every other reading.
 * Distribution rows resolve by preference - a labelled reportable
 * figure first, then the beneficiary distribution row, then a
 * two-column Distributions row, then the section's total
 * subtractions (whose lone figure is the year-to-date column in
 * this layout: the period column prints a dash). A section with no
 * distribution row emits nothing - not detected, never zero. */
export function parseSectionFields(section: StatementSection, periodMonths: number | null): RawField[] {
  const out: RawField[] = [];
  const seen = new Set<string>();
  const push = (key: string, value: string) => {
    if (seen.has(key) || value === "") return;
    seen.add(key);
    out.push({ key, value, confidence: 0.9 });
  };
  const lines = section.text.split(/\r?\n/);

  // Balance: the section's own Account Value figure - on the same
  // line or the bare figure line right under the heading.
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*Account Value:/.test(lines[i])) {
      const same = amountsIn(lines[i].replace(/Account #\s*[\d-]+/, ""));
      if (same.length) { push("statement ending balance", String(same[0])); break; }
      for (let j = i + 1; j <= Math.min(i + 2, lines.length - 1); j++) {
        const v = bareMoney(lines[j]);
        if (v !== null) { push("statement ending balance", String(v)); break; }
      }
      if (seen.has("statement ending balance")) break;
    }
  }
  if (!seen.has("statement ending balance")) {
    for (const line of lines) {
      if (/^Ending Account Value\s/.test(line)) {
        const a = amountsIn(line);
        if (a.length) { push("statement ending balance", String(a[0])); break; }
      }
    }
  }

  // Contributions (This Period | Year-to-Date rows).
  let contribPeriod: number | null = null;
  for (const line of lines) {
    const n = line.trim().toLowerCase();
    const isRow = n.startsWith("contributions ") || n === "contributions" || /^\d{4}\s+partic/.test(n);
    if (!isRow) continue;
    const a = amountsIn(line);
    if (a.length >= 2) { contribPeriod = a[0]; push("statement contributions period", String(a[0])); push("statement contributions ytd", String(a[a.length - 1])); break; }
    if (a.length === 1) { push("statement contributions ytd", String(a[0])); break; }
  }
  if (contribPeriod !== null && periodMonths === 1) {
    push("statement monthly contribution", String(contribPeriod));
  }

  // HSA deposit detail (round 57): the period total above is a
  // MONTHLY figure, never a per-paycheck one. A per-payroll
  // figure is emitted only when the section's own deposit lines
  // prove a single repeated deposit (see parseHsaDepositDetail).
  if (section.kind === "hsa") {
    const detail = parseHsaDepositDetail(section.text, contribPeriod);
    if (detail.perPayroll !== null) push("statement per-payroll contribution", String(detail.perPayroll));
  }

  // Distributions YTD, by the preference order in the header note.
  const findDist = (re: RegExp, minAmounts: number): number | null => {
    for (const line of lines) {
      if (!re.test(line)) continue;
      const a = amountsIn(line);
      if (a.length >= minAmounts) return Math.abs(a[a.length - 1]);
    }
    return null;
  };
  const dist = findDist(/reportable\s+dist/i, 1)
    ?? findDist(/distrib\.?\s+to\s+bene/i, 1)
    ?? findDist(/^distributions\b/i, 2)
    ?? findDist(/^subtractions\b/i, 1);
  if (dist !== null) push("statement distributions ytd", String(dist));

  return out;
}

/** One section's full reading: the YTD-aware section fields lead,
 * the generic pairs from the section's own text fill gaps. Two
 * honesty filters apply to fan-out readings: every fact of a
 * statement section is a figure, so prose strings the generic
 * pairing invents from endnotes are dropped; and when the section
 * parser resolved a year-to-date figure, the ambiguous generic
 * totals ("Total Contributions $89.30" - one period's activity
 * listing) are dropped so the YTD figure is the only one stored. */
export function extractSectionReading(section: StatementSection, period: StatementPeriod | null): ExtractionResult {
  const raw = [...parseSectionFields(section, period?.months ?? null), ...textToRawFields(section.text)];
  const result = extractFields(raw, section.docType);
  const fields: Record<string, number | string> = {};
  for (const [k, v] of Object.entries(result.fields)) {
    if (typeof v !== "number") continue;
    if (k === "total_contributions" && typeof result.fields["contributions_ytd"] === "number") continue;
    if (k === "total_distributions" && typeof result.fields["distributions_ytd"] === "number") continue;
    fields[k] = v;
  }
  return { ...result, fields };
}

/** The flat field strings a saved 401(k) record carries for the
 * detail facts (workstream F) - shared by the save path and the
 * reprocess pass so both write the identical shape. The after-tax
 * balance is written whenever the row was found, including the
 * confirmed $0. */
export function k401DetailFields(detail: K401Detail): Record<string, string> {
  const out: Record<string, string> = {};
  if (detail.pretaxBalance !== null) out["pretax_balance"] = String(detail.pretaxBalance);
  if (detail.matchBalance !== null) out["match_balance"] = String(detail.matchBalance);
  if (detail.rothConversionBalance !== null) out["roth_conversion_balance"] = String(detail.rothConversionBalance);
  if (detail.afterTaxBalance !== null) out["after_tax_balance"] = String(detail.afterTaxBalance);
  if (detail.election) out["future_election"] = detail.election;
  if (detail.holdings.length) out["holdings_detail"] = JSON.stringify(detail.holdings);
  return out;
}

// ---------------------------------------------------------------- SA forms

export interface SaFormParse {
  kind: "hsa_5498_sa" | "hsa_1099_sa";
  taxYear: number | null;
  accountId: string | null;
  accountOwner: string | null;
  /** The custodian's delivery date printed on the form (ISO). */
  sourceDate: string | null;
  fields: RawField[];
}

const SA_BOX_KEYS: Record<string, Record<number, string>> = {
  hsa_5498_sa: {
    2: "box 2 total contributions",
    3: "box 3 contributions for prior year",
    4: "box 4 rollover contributions",
    5: "box 5 fair market value",
    6: "box 6 account type",
  },
  hsa_1099_sa: {
    1: "box 1 gross distribution",
    2: "box 2 earnings on excess contributions",
    3: "box 3 distribution code",
    4: "box 4 fair market value on date of death",
    5: "box 5 account type",
  },
};

/** Parse an HSA tax form (5498-SA / 1099-SA). The form's own title
 * is its identity; boxes resolve by NUMBER because the IRS fixes
 * what each box means - the custodian's dotted-leader layout is
 * identical across custodians. Zeros print and persist as zeros:
 * a box the form fills with 0.00 is a confirmed zero. */
export function parseSaForm(text: string): SaFormParse | null {
  const kind: SaFormParse["kind"] | null = /form\s*5498-sa/i.test(text)
    ? "hsa_5498_sa"
    : /form\s*1099-sa/i.test(text) ? "hsa_1099_sa" : null;
  if (!kind) return null;
  const lines = text.split(/\r?\n/);
  const fields: RawField[] = [];
  const boxKeys = SA_BOX_KEYS[kind];
  for (const line of lines) {
    const m = line.match(/^\s*([1-9])\s+(.+?)\.{3,}\s*(\S+)\s*$/);
    if (!m) continue;
    const key = boxKeys[Number(m[1])];
    if (key) fields.push({ key, value: m[3], confidence: 0.9 });
  }
  const yearMatch = text.match(/(\d{4})\s+form\s+(?:5498|1099)-sa/i)
    ?? text.match(/(\d{4})\s+hsa information/i)
    ?? text.match(/(\d{4})\s+distributions from an hsa/i);
  let accountId: string | null = null;
  for (const line of lines.slice(0, 20)) {
    const a = line.match(/(\d{3}-\d{6}(?:-\d{3})?)/);
    if (a) { accountId = a[1]; break; }
  }
  let accountOwner: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const name = lines[i].trim();
    if (!/^[A-Z][A-Z .'-]{3,}$/.test(name) || /TIN|LLC|ACCOUNT/i.test(name)) continue;
    const next = (lines[i + 1] ?? "").trim();
    if (/^\d+\s+[A-Z]/.test(next)) { accountOwner = name.replace(/\s+/g, " "); break; }
  }
  const del = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*eDelivered/i);
  const sourceDate = del ? iso(Number(del[3].length === 2 ? "20" + del[3] : del[3]), Number(del[1]), Number(del[2])) : null;
  return { kind, taxYear: yearMatch ? Number(yearMatch[1]) : null, accountId, accountOwner, sourceDate, fields };
}

// ---------------------------------------------------------------- 401(k) detail

export interface K401Detail {
  pretaxBalance: number | null;
  matchBalance: number | null;
  rothConversionBalance: number | null;
  /** Exactly 0 when the statement prints $0.00 - a confirmed zero,
   * distinct from null (the row was not found). */
  afterTaxBalance: number | null;
  election: string | null;
  holdings: { label: string; value: number }[];
}

/** The NetBenefits detail tables (workstream F): contribution
 * sources with their balances, the activity-by-fund ending row
 * (the holdings), and the future-contribution election. Gates on
 * the statement's own section titles so ordinary statements are
 * untouched. */
export function parse401kDetail(text: string): K401Detail | null {
  if (!/your contribution summary/i.test(text) && !/netbenefits/i.test(text)) return null;
  const lines = text.split(/\r?\n/);
  const region = (fromRe: RegExp, toRe: RegExp): string => {
    const start = lines.findIndex((l) => fromRe.test(l));
    if (start < 0) return "";
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (toRe.test(lines[i])) { end = i; break; }
    }
    return lines.slice(start, end).join("\n");
  };
  const summary = region(/your contribution summary/i, /your account activity/i);
  const sourceBalance = (re: RegExp): number | null => {
    const m = summary.match(re);
    return m ? Number(m[3].replace(/,/g, "")) : null;
  };
  const row = (label: string) =>
    new RegExp(label + "\\s+\\$?([\\d,]+\\.\\d{2})\\s+[\\d.]+%\\s+\\$?([\\d,]+\\.\\d{2})\\s+\\$?([\\d,]+\\.\\d{2})", "i");
  const pretaxBalance = sourceBalance(row("pre-tax deferred"));
  const matchBalance = sourceBalance(row("401\\(k\\) match"));
  const afterTaxBalance = sourceBalance(row("after tax post"));
  const rothConversionBalance = sourceBalance(row("roth in-plan"));

  const byFund = region(/your account activity by fund/i, /your account activity by source/i);
  const holdings: { label: string; value: number }[] = [];
  const td = text.match(/target date\s+(\d{4})/i);
  const sp = /btc s&p 500 index/i.test(text) ? "BTC S&P 500 Index" : /s&p 500 index/i.test(text) ? "S&P 500 Index" : null;
  for (const line of byFund.split("\n")) {
    if (!/^Ending Balance\s/.test(line.trim())) continue;
    const a = amountsIn(line);
    if (a.length >= 3 && td && sp) {
      holdings.push({ label: `Target Date ${td[1]}`, value: a[0] });
      holdings.push({ label: sp, value: a[1] });
    }
    break;
  }

  const elections = region(/your current investment elections/i, /your contribution summary/i);
  let election: string | null = null;
  for (const line of elections.split("\n")) {
    const m = line.trim().match(/^(.+?)\s+100%\s*$/);
    if (m && !/^total/i.test(m[1])) { election = `100% ${m[1].trim()}`; break; }
  }

  if (pretaxBalance === null && matchBalance === null && afterTaxBalance === null && rothConversionBalance === null && !holdings.length && !election) {
    return null;
  }
  return { pretaxBalance, matchBalance, rothConversionBalance, afterTaxBalance, election, holdings };
}

// ---------------------------------------------------------------- HSA page (screenshot)

const FIRST_MONEY = /\$\s?[\d,]+\.\d{2}/;

/** Screenshot-tolerant facts for an HSA account page, used ONLY to
 * fill what the generic read missed (the caller merges fill-only,
 * like the band re-read). The balance rule is proximity: the first
 * money figure on the Balance heading's line or the three lines
 * under it - the layout every HSA page prints, and the one figure
 * real tesseract output of the owner's screenshot preserves. */
export function parseHsaPageFields(text: string): RawField[] {
  if (!/health savings account/i.test(text) || !/balance/i.test(text)) return [];
  const lines = text.split(/\r?\n/);
  const out: RawField[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/\bbalance\b/i.test(lines[i]) || lines[i].length > 80) continue;
    for (let j = i; j <= Math.min(i + 3, lines.length - 1); j++) {
      const m = lines[j].match(FIRST_MONEY);
      if (m) { out.push({ key: "statement ending balance", value: m[0], confidence: 0.9 }); break; }
    }
    if (out.length) break;
  }
  const proximity = (labelRe: RegExp, key: string) => {
    for (let i = 0; i < lines.length; i++) {
      if (!labelRe.test(lines[i])) continue;
      for (let j = i; j <= Math.min(i + 2, lines.length - 1); j++) {
        const m = lines[j].match(FIRST_MONEY) ?? lines[j].match(/[\d,]+\.\d{2}/);
        if (m) { out.push({ key, value: m[0], confidence: 0.9 }); return; }
      }
      return;
    }
  };
  proximity(/amount contributed/i, "amount contributed");
  proximity(/employer contribution/i, "employer contribution");
  return out;
}
