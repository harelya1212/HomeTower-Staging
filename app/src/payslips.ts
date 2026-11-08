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
    withEnd.sort((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : (a.d.capturedOn < b.d.capturedOn ? -1 : 1)));
    const anchor = withEnd[withEnd.length - 1];
    if (anchor.end.slice(0, 4) !== thisYear) continue; // last year's slips anchor last year, not this forecast
    const regulars = withEnd.filter((x) => (x.d.fields?.["payslip_kind"] ?? "regular") !== "bonus");
    const run = regulars.length > 0 ? regulars[regulars.length - 1] : null;

    const af = anchor.d.fields ?? {};
    const ytdGross = num(af["ytd_gross"]);
    const ytdTaxable = num(af["ytd_taxable_wages"]) ?? ytdGross;
    const ytdFederal = num(af["ytd_federal_withheld"]);
    const ytdState = num(af["ytd_state_withheld"]) ?? 0;
    if (ytdTaxable === null || ytdFederal === null) continue; // cannot drive a forecast

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
    const remaining = periodsRemaining(frequency, anchor.end);

    earners.push({
      name: member?.name ?? anchor.d.fields!["employee_name"],
      memberId: member?.id ?? null,
      anchorEnd: anchor.end,
      runRateEnd: run?.end ?? null,
      periodsRemaining: remaining,
      frequency,
      frequencyAssumed,
      hasRunRate: run !== null,
      ytdGross: ytdGross ?? ytdTaxable,
      ytdTaxable,
      ytdFederal,
      ytdState,
      projectedGross: (ytdGross ?? ytdTaxable) + rateGross * remaining,
      projectedTaxable: ytdTaxable + rateTaxable * remaining,
      projectedFederal: ytdFederal + rateFederal * remaining,
      projectedState: ytdState + rateState * remaining,
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
