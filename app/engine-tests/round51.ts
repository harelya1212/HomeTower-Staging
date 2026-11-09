// Round 51 acceptance: Copilot's source architecture, wired.
// (1) Employer match: payroll is authoritative for the match, the
// match pace is read from the freshest REGULAR slip exactly like
// the employee pace, and the projection accumulates employee pace
// + match pace - while employee totals stay employee-only.
// (2) 401(k) statement precedence: an owned statement's ending
// balance is that adult's 401(k) starting balance, replacing their
// own 401(k) asset rows; unowned statements never reach the
// outlook; with no owned statement the composition is bit-identical
// to round 50. (3) The owner harness is unchanged end to end.
// Run: node engine-tests/round51.ts
import { readFileSync } from "node:fs";
import {
  adultStartingBalance,
  deflateToToday,
  householdRetirement,
  k401StatementFor,
  projectToCommonDate,
  ageOn,
  type SsDocLike,
} from "../src/goals.ts";
import { payslip401kTotals } from "../src/payslips.ts";
import { parsePayslipRows } from "../src/payslipRows.ts";
import { extractFields } from "../engine/extract.ts";
import type { DocumentRecord } from "../engine/intake.ts";

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
}
function near(name: string, got: number, want: number, tol = 0.02) {
  const ok = Math.abs(got - want) <= tol;
  if (ok) pass++; else { fail++; console.log(`FAIL ${name}: got ${got} want ~${want}`); }
}
function ok(name: string, cond: boolean) {
  if (cond) pass++; else { fail++; console.log(`FAIL ${name}`); }
}

const slip = (fields: Record<string, string>): DocumentRecord => ({ docType: "payslip", status: "parsed", confidence: 0.9, capturedOn: "2026-11-08", fields });
const jobsAB = [
  { memberName: "Earner A", payFrequency: "semimonthly" },
  { memberName: "Earner B", payFrequency: "semimonthly" },
  { memberName: "Earner C", payFrequency: "semimonthly" },
];

// ---- 1. Match pace from the freshest REGULAR slip -----------------
{
  const docs: DocumentRecord[] = [
    slip({ employee_name: "Earner A", pay_period_end: "10/31/2026", payslip_kind: "regular", k401_contribution: "500", ytd_k401: "10000", k401_employer_match: "250", ytd_k401_employer_match: "5250" }),
    slip({ employee_name: "Earner B", pay_period_end: "10/31/2026", payslip_kind: "regular", k401_contribution: "300", ytd_k401: "6000" }),
    slip({ employee_name: "Earner B", pay_period_end: "11/15/2026", payslip_kind: "bonus", k401_bonus_contribution: "100", ytd_k401_bonus: "100", k401_employer_match: "999" }),
    slip({ employee_name: "Earner C", pay_period_end: "10/31/2026", payslip_kind: "regular", k401_contribution: "400", ytd_k401: "8000" }),
  ];
  const k = payslip401kTotals(docs, "2026-11-15", jobsAB);
  ok("totals exist", k !== null);
  const a = k!.perEarner.find((e) => e.name === "Earner A")!;
  const b = k!.perEarner.find((e) => e.name === "Earner B")!;
  const c = k!.perEarner.find((e) => e.name === "Earner C")!;
  // Semimonthly: per-period x 24 / 12 = x 2 per month.
  eq("A employee pace", a.monthlyPace, 1000);
  eq("A match pace", a.matchMonthlyPace, 500);
  eq("A employee total stays employee-only", a.total, 10000);
  eq("B employee pace (regular slip)", b.monthlyPace, 600);
  eq("B match pace: a bonus slip never sets it", b.matchMonthlyPace, null);
  eq("B employee total (regular + bonus buckets)", b.total, 6100);
  eq("C match pace: no match lines on the slip", c.matchMonthlyPace, null);
  eq("household total stays employee-only", k!.total, 24100);

  // The projection accumulates employee + match as one stream:
  // balance 100,000, employee 1,000/mo + match 500/mo, 10 years
  // contributing at 6% == the single-stream call at 1,500/mo,
  // hand-checked at 427,758.69.
  const combined = (a.monthlyPace ?? 0) + (a.matchMonthlyPace ?? 0);
  eq("combined stream", combined, 1500);
  near("projection with combined stream", projectToCommonDate(100000, combined, 10, 10, 6), 427758.69, 0.5);
  eq("combined equals single-stream 1500", projectToCommonDate(100000, combined, 10, 10, 6), projectToCommonDate(100000, 1500, 10, 10, 6));
  ok("match lifts the projection above employee-only", projectToCommonDate(100000, combined, 10, 10, 6) > projectToCommonDate(100000, a.monthlyPace ?? 0, 10, 10, 6));
}

// ---- 2. Extraction: the shipped path reads match lines ------------
// Workday row parser -> field map (the same two stages the app
// runs), on a synthetic Workday-shaped slip.
{
  const text = [
    "Payslip: Jane Doe (1234567): 10/31/2026",
    "Gross Pay 9,170.90",
    "401k Deduction 500.00 10,000.00",
    "401k Employer Match 250.00 5,250.00",
    "Federal Withholding 3,156.45 65,255.17",
  ].join("\n");
  const parsed = parsePayslipRows(text);
  const byKey = Object.fromEntries(parsed.fields.map((f) => [f.key, f.value]));
  eq("row parser: match current", byKey["401k employer match"], "250.00");
  eq("row parser: match YTD", byKey["ytd 401k employer match"], "5,250.00");
  eq("row parser: employee row untouched", byKey["401k deduction"], "500.00");
  const ext = extractFields(parsed.fields, "payslip");
  eq("field map: k401_employer_match", ext.fields["k401_employer_match"], 250);
  eq("field map: ytd_k401_employer_match", ext.fields["ytd_k401_employer_match"], 5250);
  eq("field map: employee contribution separate", ext.fields["k401_contribution"], 500);
  // The other phrasings resolve to the same canonical field, and
  // the bare "employer" (the employer's NAME) is never stolen.
  eq("phrasing: Employer Match", extractFields([{ key: "Employer Match", value: "250.00", confidence: 0.9 }], "payslip").fields["k401_employer_match"], 250);
  eq("phrasing: Company Match", extractFields([{ key: "Company Match", value: "250.00", confidence: 0.9 }], "payslip").fields["k401_employer_match"], 250);
  eq("phrasing: Employer 401k Contribution", extractFields([{ key: "Employer 401k Contribution", value: "250.00", confidence: 0.9 }], "payslip").fields["k401_employer_match"], 250);
  eq("employer name label untouched", extractFields([{ key: "Employer", value: "Intel", confidence: 0.9 }], "payslip").fields["employer"], "Intel");
}

// ---- 3. Statement precedence --------------------------------------
{
  const stmt = (balance: string, capturedOn: string, owner?: string): SsDocLike => ({
    docType: "401k_statement",
    ...(owner ? { ownerMemberId: owner } : {}),
    capturedOn,
    fields: { ending_balance: balance },
  });
  const docs: SsDocLike[] = [stmt("200000", "2026-03-01", "m1"), stmt("250000", "2026-09-01", "m1"), stmt("999000", "2026-10-01")];
  const mine = k401StatementFor(docs, "m1");
  eq("freshest owned statement wins", mine?.balance, 250000);
  eq("freshest owned statement date", mine?.capturedOn, "2026-09-01");
  eq("unowned fresher statement never counts", k401StatementFor(docs, "m2"), null);
  eq("no statements at all", k401StatementFor([], "m1"), null);

  // The brief's case: owned statement 250,000 + same-kind asset
  // entry 180,000 -> the start uses 250,000 and excludes the 180,000.
  const c1 = adultStartingBalance({ owned: [{ kind: "401k", value: 180000 }], fallback: 0, statement401k: mine?.balance ?? 0 });
  eq("precedence: start is the statement balance", c1.balance, 250000);
  eq("precedence: replaced amount reported", c1.replaced401k, 180000);
  eq("precedence: applied flag", c1.statementApplied, true);
  // Other kinds are untouched: IRA + HSA rows stay, only the 401(k)
  // sleeve is replaced.
  const c2 = adultStartingBalance({ owned: [{ kind: "401k", value: 180000 }, { kind: "ira", value: 50000 }, { kind: "hsa", value: 20000 }], fallback: 0, statement401k: 250000 });
  eq("precedence: other kinds untouched", c2.balance, 320000);
  // No statement: the composition is exactly the old one.
  const c3 = adultStartingBalance({ owned: [{ kind: "401k", value: 180000 }, { kind: "ira", value: 50000 }], fallback: 777, statement401k: 0 });
  eq("no statement: owned sum", c3.balance, 230000);
  eq("no statement: not applied", c3.statementApplied, false);
  const c4 = adultStartingBalance({ owned: [], fallback: 90000, statement401k: 0 });
  eq("no statement: fallback", c4.balance, 90000);
  // Statement with nothing entered: it becomes the balance.
  const c5 = adultStartingBalance({ owned: [], fallback: 0, statement401k: 250000 });
  eq("statement, nothing entered: statement is the start", c5.balance, 250000);
  eq("statement, nothing entered: applied", c5.statementApplied, true);
  // Statement + household-aggregate fallback: no guessing - the
  // fallback already lumps every 401(k)/IRA row, so it stands.
  const c6 = adultStartingBalance({ owned: [], fallback: 90000, statement401k: 250000 });
  eq("statement + aggregate fallback: fallback stands", c6.balance, 90000);
  eq("statement + aggregate fallback: not applied", c6.statementApplied, false);
}

// ---- 4. Owner harness: unchanged end to end ------------------------
// The fixtures carry NO employer-match lines and NO 401(k)
// statements, so every round-51 input is inert on his data: the
// Documents-card totals (round 39), the projected portfolio, the
// need and the readiness must equal the round-48/50 figures.
{
  const fx = JSON.parse(readFileSync("/home/hatch/workspace/hometower/prepared-payslips.json", "utf8"));
  const documents = fx.records as DocumentRecord[];
  const jobs = [
    { memberName: "Assaf Harel", payFrequency: "semimonthly" },
    { memberName: "Yamit Harel", payFrequency: "semimonthly" },
  ];
  const today = "2026-11-08";
  const k = payslip401kTotals(documents, today, jobs);
  ok("harness totals exist", k !== null);
  near("harness Documents-card total (round 39)", k!.total, 33685.47);
  near("harness Assaf employee total", k!.perEarner.find((e) => e.name === "Assaf Harel")!.total, 23269.74);
  near("harness Yamit employee total", k!.perEarner.find((e) => e.name === "Yamit Harel")!.total, 10415.73);
  eq("harness match pace Assaf (fixtures carry none)", k!.perEarner.find((e) => e.name === "Assaf Harel")!.matchMonthlyPace, null);
  eq("harness match pace Yamit (fixtures carry none)", k!.perEarner.find((e) => e.name === "Yamit Harel")!.matchMonthlyPace, null);
  eq("harness no owned 401k statement", k401StatementFor(documents as SsDocLike[], "a"), null);

  // The round-48 harness model, now with the round-51 stream
  // (employee pace + match pace) and statement-aware starts (none).
  const paceOf = (name: string) => k!.perEarner.find((e) => e.name === name)?.monthlyPace ?? 0;
  const matchOf = (name: string) => k!.perEarner.find((e) => e.name === name)?.matchMonthlyPace ?? 0;
  const adultsModel = [
    { dob: "1977-09-26", retireAge: 60, mo: paceOf("Assaf Harel") + matchOf("Assaf Harel") },
    { dob: "1978-05-15", retireAge: 50, mo: paceOf("Yamit Harel") + matchOf("Yamit Harel") },
  ];
  const yearsOwn = adultsModel.map((a) => Math.max(0, a.retireAge - (ageOn(a.dob, today) ?? 0)));
  const laterYears = Math.max(...yearsOwn);
  const nominal = adultsModel.reduce((s, a, i) => s + projectToCommonDate(0, a.mo, yearsOwn[i], laterYears, 6), 0);
  const projectedToday = deflateToToday(nominal, laterYears, 2.5);
  eq("harness projected portfolio unchanged (today's $)", Math.round(projectedToday), 374033);
  const hhRet = householdRetirement({ spendingAnnual: 341566, socialSecurityAnnual: 0, pensionAnnual: 0, otherAnnual: 0, projectedPortfolio: projectedToday });
  eq("harness need unchanged", hhRet.needBase, 8539150);
  eq("harness readiness unchanged", Math.round((projectedToday / hhRet.needBase) * 100), 4);
  console.log(`     harness: projected ${Math.round(projectedToday)}, need ${hhRet.needBase}, readiness ${Math.round((projectedToday / hhRet.needBase) * 100)}% (before = after)`);
}

const total = pass + fail;
console.log(fail === 0 ? `ROUND51 OK ${pass}/${total}` : `ROUND51 FAILURES ${fail}/${total}`);
if (fail > 0) process.exit(1);
