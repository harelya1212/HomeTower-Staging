// Per-earner payslip projection (pure module).
//
// A saved payslip is evidence; this module turns the evidence into
// the forecast's inputs - the bridge the Intake-only model never
// had. For each earner (identified by the name printed on the slip):
//
//   projected year-end = YTD on the freshest slip
//                      + per-period run rate x pay periods remaining
//
// The freshest slip is the YTD ANCHOR even when it is a bonus run
// (its YTD already includes everything before it), but the RUN RATE
// always comes from the latest REGULAR slip - a bonus is not a pay
// cycle. W-2 taxable wages are the income basis (post 401(k)/HSA),
// falling back to gross pay when the slip prints no taxable-wages
// row. Everything is labelled: the caller shows whose slips, through
// which date, plus how many periods, at which assumed frequency.
import type { DocumentRecord } from "../engine/intake.ts";

export interface MemberLike { id: string; name: string; role: string }
export interface JobLike { memberName: string; payFrequency: string }

export interface EarnerProjection {
  name: string;
  memberId: string | null;
  anchorEnd: string; // ISO - YTD is cumulative through this date
  runRateEnd: string | null; // ISO - the regular slip the rate came from
  periodsRemaining: number;
  frequency: string;
  frequencyAssumed: boolean;
  hasRunRate: boolean;
  ytdGross: number;
  ytdTaxable: number;
  ytdFederal: number;
  ytdState: number;
  projectedGross: number;
  projectedTaxable: number;
  projectedFederal: number;
  projectedState: number;
  // Additional Medicare (engine round 45): Medicare wages are the
  // earner's projected gross (401(k) does not reduce Medicare wages;
  // the slips print no separate Medicare-wages row). The withheld
  // side is what the employer actually took in Medicare tax (1.45%
  // base + the extra 0.9% over $200K): READ from the slips when a
  // Medicare line was captured, otherwise ESTIMATED from gross by
  // the statutory rates - medicareBasis says which.
  projectedMedicareWages: number;
  projectedMedicareWithheld: number;
  projectedAddMedWithheld: number;
  medicareBasis: "read" | "estimated";
}

export interface PayslipForecast {
  earners: EarnerProjection[];
  projectedGross: number;
  projectedTaxable: number;
  projectedFederal: number;
  projectedState: number;
  projectedMedicareWages: number;
  projectedMedicareWithheld: number;
  projectedAddMedWithheld: number;
  medicareBasis: "read" | "estimated";
}

const PERIODS_PER_YEAR: Record<string, number> = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 };

/** ROUND 59 (TRACE C) - the frequency a pace is annualized with is
 * read from the earner's OWN slip period ends before the job record
 * is believed: a job record still carrying the form's "biweekly"
 * default turned a real semi-monthly $44.65/check into $97/mo on
 * the HSA card while every piece of payroll evidence (slips ending
 * on the 15th and at month-end; statement deposits twice a month)
 * said 24 periods a year. Decisive signatures, in order: ends on
 * BOTH the 15th and a month-end (the semi-monthly signature - a
 * biweekly cycle lands 14 days apart and cannot produce that pair
 * in adjacent periods); all ends on one day-of-month or all at
 * month-end across 2+ months (monthly); median spacing of about a
 * week, about two weeks, or about a month. Anything indecisive
 * falls back to the job record, then to semi-monthly (the app's
 * standing default - see the forecast's signature comment). */
export function periodsPerYearForEarner(ends: string[], jobFrequency?: string | null): number {
  const sorted = [...new Set(ends.filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e)))].sort();
  if (sorted.length >= 2) {
    const parts = sorted.map((e) => ({ y: Number(e.slice(0, 4)), m: Number(e.slice(5, 7)), d: Number(e.slice(8, 10)) }));
    const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
    const isLast = parts.map((p) => p.d === lastDay(p.y, p.m));
    const allSemiDays = parts.every((p, i) => p.d === 15 || isLast[i]);
    if (allSemiDays && parts.some((p) => p.d === 15) && isLast.some(Boolean)) return 24;
    const months = new Set(parts.map((p) => `${p.y}-${p.m}`));
    if (months.size >= 2 && (parts.every((p) => p.d === parts[0].d) || isLast.every(Boolean))) return 12;
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) gaps.push(Math.round((Date.parse(sorted[i]) - Date.parse(sorted[i - 1])) / 86400000));
    gaps.sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)];
    if (median >= 6 && median <= 8) return 52;
    if (median >= 13 && median <= 15) return 26;
    if (median >= 27 && median <= 32) return 12;
  }
  return PERIODS_PER_YEAR[(jobFrequency ?? "semimonthly").toLowerCase()] ?? 24;
}

function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
}

function num(v: string | undefined): number | null {
  if (v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Payslip fields carry US dates (MM/DD/YYYY); capturedOn is ISO.
export function usToIso(d: string | undefined): string | null {
  if (!d) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function slipEnd(doc: DocumentRecord): string | null {
  const f = doc.fields ?? {};
  return usToIso(f["pay_period_end"]) ?? usToIso(f["check_date"]) ?? (doc.capturedOn || null);
}

function periodsRemaining(freq: string, endIso: string): number {
  const [y, m, d] = endIso.split("-").map(Number);
  const per = PERIODS_PER_YEAR[freq] ?? 24;
  if (freq === "semimonthly") {
    const elapsed = (m - 1) * 2 + (d >= 16 ? 2 : 1);
    return Math.max(0, 24 - elapsed);
  }
  if (freq === "monthly") {
    const elapsed = d >= 28 ? m : m - 1;
    return Math.max(0, 12 - elapsed);
  }
  // weekly / biweekly: day-count approximation (the forecast labels
  // the frequency it assumed; the confirm card keeps the data honest)
  const start = Date.UTC(y, 0, 1);
  const dayOfYear = Math.floor((Date.UTC(y, m - 1, d) - start) / 86400000) + 1;
  const elapsed = Math.min(per, Math.round(dayOfYear / (365.25 / per)));
  return Math.max(0, per - elapsed);
  void y;
}

// Identity of one physical payslip across its pages: same earner,
// same period end. Two screenshots carrying the same key are pages
// of ONE slip, not two slips.
export function payslipKey(fields: Record<string, string | number>): string {
  const name = normName(String(fields["employee_name"] ?? ""));
  const end = usToIso(String(fields["pay_period_end"] ?? "")) ?? usToIso(String(fields["check_date"] ?? "")) ?? "";
  return name === "" ? "" : `${name}|${end}`;
}

// Merge two pages' readings of the same slip into one field set.
// The earlier page wins on a conflicting figure (page order in a
// batch follows the document); the later page fills the gaps - the
// tables a payslip splits across pages are disjoint by construction.
// A bonus marker on either page marks the merged slip as a bonus run.
export function mergePayslipFields(prev: Record<string, string>, next: Record<string, string>): Record<string, string> {
  const merged: Record<string, string> = { ...next, ...prev };
  if (prev["payslip_kind"] === "bonus" || next["payslip_kind"] === "bonus") merged["payslip_kind"] = "bonus";
  return merged;
}

// Diagnosis for the silent case (owner device test, 2026-11-08):
// payslips are saved, the cards even say UP TO DATE, yet the
// forecast is null because each earner's readings are missing a
// gate component and NOTHING in the app said so. This reports, per
// earner, exactly which components no saved slip provided - the
// Home screen shows it instead of a silent blank.
export interface PayslipDeductionTotals {
  esppYtd: number;
  /** Monthly ESPP pace from the freshest REGULAR slip per earner,
   * annualized - bonus slips never set pace (same rule as 401(k)). */
  esppMonthlyPace: number | null;
  hsaYtd: number;
  hsaMonthlyPace: number | null;
  perEarner: { name: string; esppYtd: number; esppMonthlyPace: number | null; hsaYtd: number; hsaMonthlyPace: number | null }[];
}

/**
 * ROUND 52 - ESPP and HSA read off the payslips, with exactly the
 * evidence discipline of payslip401kTotals: slips grouped per
 * earner, freshest first (a fuller reading wins a same-date tie);
 * year-to-date from the freshest slip that carries it (YTD figures
 * are cumulative - never summed across one earner's slips); pace
 * from the freshest REGULAR slip carrying the item, annualized by
 * the pay frequency. The parsed fields have existed since the
 * first field maps; nothing read them until the provenance round.
 * Null when there are no payslips at all; pace null when no regular
 * slip carries the item - an absent item is Unknown/Not detected
 * downstream, never a $0 finding.
 */
export function payslipDeductionTotals(
  documents: DocumentRecord[],
  todayIso: string,
  jobs: JobLike[] = [],
): PayslipDeductionTotals | null {
  const slips = documents.filter((d) => d.docType === "payslip" && d.fields && (d.fields["employee_name"] ?? "").trim() !== "");
  if (slips.length === 0) return null;
  const thisYear = todayIso.slice(0, 4);
  const byEarner = new Map<string, DocumentRecord[]>();
  for (const s of slips) {
    const key = normName(s.fields!["employee_name"]);
    const arr = byEarner.get(key) ?? [];
    arr.push(s);
    byEarner.set(key, arr);
  }
  const fieldCount = (d: DocumentRecord) => Object.values(d.fields ?? {}).filter((v) => v !== "").length;
  const perEarner: PayslipDeductionTotals["perEarner"] = [];
  for (const [key, docs] of byEarner) {
    const withEnd = docs.map((d) => ({ d, end: slipEnd(d) })).filter((x) => x.end !== null && x.end.slice(0, 4) === thisYear) as Array<{ d: DocumentRecord; end: string }>;
    if (withEnd.length === 0) continue;
    withEnd.sort((a, b) => (a.end > b.end ? -1 : a.end < b.end ? 1 : fieldCount(b.d) - fieldCount(a.d) || (a.d.capturedOn > b.d.capturedOn ? -1 : 1)));
    const pick = (field: string) => {
      for (const x of withEnd) {
        const v = num((x.d.fields ?? {})[field]);
        if (v !== null) return v;
      }
      return null;
    };
    const job = jobs.find((j) => normName(j.memberName) === key);
    const perYear = periodsPerYearForEarner(withEnd.map((x) => x.end), job?.payFrequency);
    const pace = (field: string) => {
      for (const x of withEnd) {
        const f = x.d.fields ?? {};
        if ((f["payslip_kind"] ?? "regular") === "bonus") continue;
        const cur = num(f[field]);
        if (cur !== null) return Math.round(((cur * perYear) / 12) * 100) / 100;
      }
      return null;
    };
    const esppYtd = pick("ytd_espp");
    const hsaYtd = pick("ytd_hsa");
    const esppMonthlyPace = pace("espp_contribution");
    const hsaMonthlyPace = pace("hsa_contribution");
    if (esppYtd === null && hsaYtd === null && esppMonthlyPace === null && hsaMonthlyPace === null) continue;
    perEarner.push({ name: docs[0].fields!["employee_name"] || key, esppYtd: esppYtd ?? 0, esppMonthlyPace, hsaYtd: hsaYtd ?? 0, hsaMonthlyPace });
  }
  const paceSum = (pickFn: (e: PayslipDeductionTotals["perEarner"][number]) => number | null) => {
    const vals = perEarner.map(pickFn).filter((v): v is number => v !== null);
    return vals.length > 0 ? Math.round(vals.reduce((sum, v) => sum + v, 0) * 100) / 100 : null;
  };
  return {
    esppYtd: Math.round(perEarner.reduce((sum, e) => sum + e.esppYtd, 0) * 100) / 100,
    esppMonthlyPace: paceSum((e) => e.esppMonthlyPace),
    hsaYtd: Math.round(perEarner.reduce((sum, e) => sum + e.hsaYtd, 0) * 100) / 100,
    hsaMonthlyPace: paceSum((e) => e.hsaMonthlyPace),
    perEarner,
  };
}

export interface PayslipGap { name: string; missing: string[] }

export function payslipGaps(documents: DocumentRecord[], todayIso: string): PayslipGap[] {
  const slips = documents.filter((d) => d.docType === "payslip" && d.fields && (d.fields["employee_name"] ?? "").trim() !== "");
  if (slips.length === 0) return [];
  const thisYear = todayIso.slice(0, 4);
  const byEarner = new Map<string, DocumentRecord[]>();
  for (const s of slips) {
    const key = normName(s.fields!["employee_name"]);
    const arr = byEarner.get(key) ?? [];
    arr.push(s);
    byEarner.set(key, arr);
  }
  const gaps: PayslipGap[] = [];
  for (const [key, docs] of byEarner) {
    const withEnd = docs.map((d) => ({ d, end: slipEnd(d) })).filter((x) => x.end !== null && x.end.slice(0, 4) === thisYear) as Array<{ d: DocumentRecord; end: string }>;
    const name = docs[0].fields!["employee_name"] || key;
    if (withEnd.length === 0) {
      gaps.push({ name, missing: ["a pay-period date in 2026 on any reading"] });
      continue;
    }
    const has = (get: (f: Record<string, string>) => number | null) => withEnd.some((x) => get(x.d.fields ?? {}) !== null);
    const missing: string[] = [];
    if (!has((f) => num(f["ytd_taxable_wages"]) ?? num(f["ytd_gross"]))) missing.push("taxable wages YTD (or gross pay YTD)");
    if (!has((f) => num(f["ytd_federal_withheld"]))) missing.push("federal withholding YTD");
    if (missing.length > 0) gaps.push({ name, missing });
  }
  return gaps;
}

export interface Payslip401k {
  perEarner: Array<{ name: string; total: number; through: string; monthlyPace: number | null; matchMonthlyPace: number | null }>;
  total: number;
  earners: number;
  through: string; // ISO - freshest period end any component came from
  year: string;
}

// 401(k) contributions tracked from payslips - the ONLY function
// that totals this money (owner rule, 2026-11-08: payslip data and
// statement data describe the same dollars, so the two sources are
// never added together; a statement is the balance source of record
// and its contribution figures are never summed with these).
// YTD figures are CUMULATIVE: per earner and per bucket (regular /
// bonus are separate deduction rows), the value comes from the
// freshest slip that has it - fuller reading wins a same-date tie -
// so re-uploaded slips and partial readings can never multiply the
// total. Buckets add within an earner; earners add across the
// household. Nothing else in the app may sum ytd_k401 fields.
export function payslip401kTotals(documents: DocumentRecord[], todayIso: string, jobs: JobLike[] = []): Payslip401k | null {
  const slips = documents.filter((d) => d.docType === "payslip" && d.fields && (d.fields["employee_name"] ?? "").trim() !== "");
  if (slips.length === 0) return null;
  const thisYear = todayIso.slice(0, 4);
  const byEarner = new Map<string, DocumentRecord[]>();
  for (const s of slips) {
    const key = normName(s.fields!["employee_name"]);
    const arr = byEarner.get(key) ?? [];
    arr.push(s);
    byEarner.set(key, arr);
  }
  const fieldCount = (d: DocumentRecord) => Object.values(d.fields ?? {}).filter((v) => v !== "").length;
  const perEarner: Payslip401k["perEarner"] = [];
  let through = "";
  for (const [key, docs] of byEarner) {
    const withEnd = docs.map((d) => ({ d, end: slipEnd(d) })).filter((x) => x.end !== null && x.end.slice(0, 4) === thisYear) as Array<{ d: DocumentRecord; end: string }>;
    if (withEnd.length === 0) continue;
    withEnd.sort((a, b) => (a.end > b.end ? -1 : a.end < b.end ? 1 : fieldCount(b.d) - fieldCount(a.d) || (a.d.capturedOn > b.d.capturedOn ? -1 : 1)));
    const pick = (field: string) => {
      for (const x of withEnd) {
        const v = num((x.d.fields ?? {})[field]);
        if (v !== null) return { value: v, end: x.end };
      }
      return null;
    };
    const reg = pick("ytd_k401");
    const bon = pick("ytd_k401_bonus");
    if (reg === null && bon === null) continue;
    const eThrough = [reg?.end ?? "", bon?.end ?? ""].sort().slice(-1)[0];
    // Monthly pace (owner QA, 2026-11-08: the retirement outlook
    // showed $0/mo while the payslips prove a real payroll pace):
    // the freshest REGULAR slip's current-period contribution,
    // annualized by the pay frequency (job record when known, else
    // the semimonthly signature). Bonus contributions are events,
    // not a pace, so they never set it.
    let monthlyPace: number | null = null;
    const job = jobs.find((j) => normName(j.memberName) === key);
    const perYear = periodsPerYearForEarner(withEnd.map((x) => x.end), job?.payFrequency);
    for (const x of withEnd) {
      const f = x.d.fields ?? {};
      if ((f["payslip_kind"] ?? "regular") === "bonus") continue;
      const cur = num(f["k401_contribution"]);
      if (cur !== null) { monthlyPace = Math.round(((cur * perYear) / 12) * 100) / 100; break; }
    }
    // Employer match pace (round 51, Copilot's source doctrine:
    // payroll is authoritative for employer match, and the projected
    // portfolio is current assets + employee contributions +
    // EMPLOYER contributions + growth). Same rule as the employee
    // pace, read independently: the freshest REGULAR slip carrying
    // a match line sets it, annualized the same way; a bonus run's
    // match is an event, never a pace. Kept in its own field - the
    // totals above stay employee-only, by the owner's rule.
    let matchMonthlyPace: number | null = null;
    for (const x of withEnd) {
      const f = x.d.fields ?? {};
      if ((f["payslip_kind"] ?? "regular") === "bonus") continue;
      const cur = num(f["k401_employer_match"]);
      if (cur !== null) { matchMonthlyPace = Math.round(((cur * perYear) / 12) * 100) / 100; break; }
    }
    perEarner.push({ name: docs[0].fields!["employee_name"] || key, total: (reg?.value ?? 0) + (bon?.value ?? 0), through: eThrough, monthlyPace, matchMonthlyPace });
    if (eThrough > through) through = eThrough;
    void key;
  }
  if (perEarner.length === 0) return null;
  return { perEarner, total: perEarner.reduce((s, e) => s + e.total, 0), earners: perEarner.length, through, year: thisYear };
}

export function payslipForecast(
  documents: DocumentRecord[],
  family: MemberLike[],
  jobs: JobLike[],
  todayIso: string,
): PayslipForecast | null {
  const slips = documents.filter((d) => d.docType === "payslip" && d.fields && (d.fields["employee_name"] ?? "").trim() !== "");
  if (slips.length === 0) return null;
  const thisYear = todayIso.slice(0, 4);

  const byEarner = new Map<string, DocumentRecord[]>();
  for (const s of slips) {
    const key = normName(s.fields!["employee_name"]);
    const arr = byEarner.get(key) ?? [];
    arr.push(s);
    byEarner.set(key, arr);
  }

  const earners: EarnerProjection[] = [];
  for (const [key, docs] of byEarner) {
    const withEnd = docs.map((d) => ({ d, end: slipEnd(d) })).filter((x) => x.end !== null) as Array<{ d: DocumentRecord; end: string }>;
    if (withEnd.length === 0) continue;
    // Freshest first; a fuller reading wins a same-date tie (a
    // re-uploaded clearer screenshot of the same slip beats the
    // partial first reading).
    const fieldCount = (d: DocumentRecord) => Object.values(d.fields ?? {}).filter((v) => v !== "").length;
    withEnd.sort((a, b) => (a.end > b.end ? -1 : a.end < b.end ? 1 : fieldCount(b.d) - fieldCount(a.d) || (a.d.capturedOn > b.d.capturedOn ? -1 : 1)));
    if (withEnd[0].end.slice(0, 4) !== thisYear) continue; // last year's slips anchor last year, not this forecast
    const regulars = withEnd.filter((x) => (x.d.fields?.["payslip_kind"] ?? "regular") !== "bonus");
    const run = regulars.length > 0 ? regulars[0] : null;

    // Per-component anchors (robustness, 2026-11-08): a single
    // screenshot reading can miss a whole section, so each YTD
    // component comes from the freshest slip that HAS it, and
    // projects forward from THAT slip's date. The bonus slip usually
    // anchors everything; when its reading is partial, the regular
    // slip's figures carry the missing components instead of the
    // whole earner dropping out of the forecast.
    const pick = (get: (f: Record<string, string>) => number | null) => {
      for (const x of withEnd) {
        const v = get(x.d.fields ?? {});
        if (v !== null) return { value: v, end: x.end };
      }
      return null;
    };
    const cTaxable = pick((f) => num(f["ytd_taxable_wages"]) ?? num(f["ytd_gross"]));
    const cFederal = pick((f) => num(f["ytd_federal_withheld"]));
    const cState = pick((f) => num(f["ytd_state_withheld"]));
    const cGross = pick((f) => num(f["ytd_gross"]) ?? num(f["ytd_taxable_wages"]));
    const cMedicare = pick((f) => num(f["ytd_medicare_withheld"]));
    if (cTaxable === null || cFederal === null) continue; // income + federal withholding are the forecast's minimum

    const rf = run?.d.fields ?? {};
    const rateGross = run ? num(rf["gross_pay"]) ?? 0 : 0;
    const rateTaxable = run ? num(rf["taxable_wages"]) ?? num(rf["gross_pay"]) ?? 0 : 0;
    const rateFederal = run ? num(rf["federal_withheld"]) ?? 0 : 0;
    const rateState = run ? num(rf["state_withheld"]) ?? 0 : 0;
    const rateMedicare = run ? num(rf["medicare_withheld"]) : null;

    const member = family.find((m) => normName(m.name) === key)
      ?? family.find((m) => normName(m.name).split(" ")[0] !== "" && normName(m.name).split(" ")[0] === key.split(" ")[0] && normName(m.name).split(" ").slice(-1)[0] === key.split(" ").slice(-1)[0]);
    const job = member ? jobs.find((j) => normName(j.memberName) === normName(member.name)) : undefined;
    let frequency = job?.payFrequency ?? "";
    let frequencyAssumed = false;
    if (!frequency) {
      frequency = "semimonthly"; // period ends on the 15th / month-end are the semimonthly signature
      frequencyAssumed = true;
    }
    const anchorEnd = [cTaxable.end, cFederal.end, cState?.end ?? "", cGross?.end ?? ""].sort().slice(-1)[0];

    const projectedGrossE = (cGross?.value ?? cTaxable.value) + rateGross * periodsRemaining(frequency, cGross?.end ?? cTaxable.end);
    // Medicare withheld, full year (round 45): READ path - the
    // slips' own YTD Medicare plus the regular slip's per-period
    // Medicare for the periods left after the Medicare anchor.
    // ESTIMATED path - no Medicare line captured: the statutory
    // employer formula on projected gross (1.45% on all wages +
    // 0.9% over $200K for this earner). The Additional-Medicare
    // part of what was withheld is the excess over the 1.45% base.
    const medicareRead = cMedicare !== null && rateMedicare !== null;
    const projectedMedicareWithheldE = medicareRead
      ? cMedicare.value + rateMedicare * periodsRemaining(frequency, cMedicare.end)
      : 0.0145 * projectedGrossE + 0.009 * Math.max(0, projectedGrossE - 200000);
    const projectedAddMedWithheldE = Math.max(0, projectedMedicareWithheldE - 0.0145 * projectedGrossE);

    earners.push({
      name: member?.name ?? withEnd[0].d.fields!["employee_name"],
      memberId: member?.id ?? null,
      anchorEnd,
      runRateEnd: run?.end ?? null,
      periodsRemaining: periodsRemaining(frequency, cTaxable.end),
      frequency,
      frequencyAssumed,
      hasRunRate: run !== null,
      ytdGross: cGross?.value ?? cTaxable.value,
      ytdTaxable: cTaxable.value,
      ytdFederal: cFederal.value,
      ytdState: cState?.value ?? 0,
      projectedGross: projectedGrossE,
      projectedTaxable: cTaxable.value + rateTaxable * periodsRemaining(frequency, cTaxable.end),
      projectedFederal: cFederal.value + rateFederal * periodsRemaining(frequency, cFederal.end),
      projectedState: (cState?.value ?? 0) + rateState * (cState ? periodsRemaining(frequency, cState.end) : 0),
      projectedMedicareWages: projectedGrossE,
      projectedMedicareWithheld: projectedMedicareWithheldE,
      projectedAddMedWithheld: projectedAddMedWithheldE,
      medicareBasis: medicareRead ? "read" : "estimated",
    });
  }
  if (earners.length === 0) return null;
  const sum = (k: keyof EarnerProjection) => earners.reduce((a, e) => a + (e[k] as number), 0);
  return {
    earners,
    projectedGross: sum("projectedGross"),
    projectedTaxable: sum("projectedTaxable"),
    projectedFederal: sum("projectedFederal"),
    projectedState: sum("projectedState"),
    projectedMedicareWages: sum("projectedMedicareWages"),
    projectedMedicareWithheld: sum("projectedMedicareWithheld"),
    projectedAddMedWithheld: sum("projectedAddMedWithheld"),
    medicareBasis: earners.every((e) => e.medicareBasis === "read") ? "read" : "estimated",
  };
}
