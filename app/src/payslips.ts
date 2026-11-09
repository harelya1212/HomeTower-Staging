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
}

export interface PayslipForecast {
  earners: EarnerProjection[];
  projectedGross: number;
  projectedTaxable: number;
  projectedFederal: number;
  projectedState: number;
}

const PERIODS_PER_YEAR: Record<string, number> = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 };

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
    if (cTaxable === null || cFederal === null) continue; // income + federal withholding are the forecast's minimum

    const rf = run?.d.fields ?? {};
    const rateGross = run ? num(rf["gross_pay"]) ?? 0 : 0;
    const rateTaxable = run ? num(rf["taxable_wages"]) ?? num(rf["gross_pay"]) ?? 0 : 0;
    const rateFederal = run ? num(rf["federal_withheld"]) ?? 0 : 0;
    const rateState = run ? num(rf["state_withheld"]) ?? 0 : 0;

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
      projectedGross: (cGross?.value ?? cTaxable.value) + rateGross * periodsRemaining(frequency, cGross?.end ?? cTaxable.end),
      projectedTaxable: cTaxable.value + rateTaxable * periodsRemaining(frequency, cTaxable.end),
      projectedFederal: cFederal.value + rateFederal * periodsRemaining(frequency, cFederal.end),
      projectedState: (cState?.value ?? 0) + rateState * (cState ? periodsRemaining(frequency, cState.end) : 0),
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
  };
}
