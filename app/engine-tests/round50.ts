// Round 50 acceptance: (1) evidence gating on the Retirement
// Lifestyle page - Group-2 savings/work amounts are NEVER spending
// evidence, the result view renders only on real evidence, and a
// lifestyle that is not estimated never displays as $0; (2) the
// 3-step personalization wizard's write paths at the helper/store
// level (quick tier, manual SS via ssForMember, step-3 "No" setting
// noPension only when no pension data exists); (3) the owner
// harness: his payslip fixtures produce the entry view plus the
// know-so-far card at the exact fixture Group-2 total, with no $0
// lifestyle anywhere. Run: node engine-tests/round50.ts
import { readFileSync } from "node:fs";
import {
  chooseSpending,
  lifestyleDisplayState,
  lifestyleGroupTotals,
  pensionOnFile,
  ssForMember,
  LIFESTYLE_NOT_ESTIMATED,
  type LifestyleData,
  type LifestyleExceptionsData,
  type QuickEstimateData,
} from "../src/goals.ts";
import { payslip401kTotals } from "../src/payslips.ts";

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

const lifeBase: LifestyleData = { amounts: {}, states: {}, adjusted: {}, additionsAnnual: 0, confirmed: false };
const qBase: QuickEstimateData = { monthlySpend: 0, mortgageEndsMonthly: 0, collegeEndsAnnual: 0, travelAdjustPct: 0, healthcareBridgeAnnual: 0, done: false };
const exBase: LifestyleExceptionsData = { mortgageAtRetirement: "", mortgageMonthly: 0, collegeContinuesAnnual: 0, healthcareBridgeAnnual: 0, majorChangeAnnual: 0, travel: "" };

// ---- (a) Group-2 only: the device defect --------------------------
// ONLY the payslip 401(k) prefill in the model. Round 49 showed the
// result view ("You spend about $X/yr today ... $0/yr lifestyle").
// Round 50: entry view, know-so-far card, lifestyle not estimated.
{
  const l: LifestyleData = { ...lifeBase, amounts: { k401: 41400 } };
  const d = lifestyleDisplayState(l, qBase, exBase);
  eq("a group2Total is the know-so-far figure", d.group2Total, 41400);
  eq("a group1Total", d.group1Total, 0);
  eq("a hasSpendingEvidence", d.hasSpendingEvidence, false);
  eq("a showResult", d.showResult, false);
  eq("a lifestyleLabel", d.lifestyleLabel, LIFESTYLE_NOT_ESTIMATED);
  eq("a lifestyleLabel text", d.lifestyleLabel, "Not estimated yet");
}

// Group-2 breadth: every Group-2 key filled, still no evidence.
{
  const l: LifestyleData = {
    ...lifeBase,
    amounts: { k401: 41400, hsa_contrib: 4150, espp: 6000, contrib529: 12000, payroll_taxes: 30000, work_commuting: 2400, college_support: 20000, mortgage_ending: 18000 },
  };
  const d = lifestyleDisplayState(l, qBase, exBase);
  eq("a2 group2Total", d.group2Total, 133950);
  eq("a2 hasSpendingEvidence", d.hasSpendingEvidence, false);
  eq("a2 showResult", d.showResult, false);
  eq("a2 lifestyleLabel", d.lifestyleLabel, "Not estimated yet");
}

// ---- (b) Group-1 food only: result view ---------------------------
{
  const l: LifestyleData = { ...lifeBase, amounts: { food: 12000 } };
  const d = lifestyleDisplayState(l, qBase, exBase);
  eq("b group1Total", d.group1Total, 12000);
  eq("b hasSpendingEvidence", d.hasSpendingEvidence, true);
  eq("b showResult", d.showResult, true);
  eq("b lifestyleAnnual", d.lifestyleAnnual, 12000);
  eq("b lifestyleLabel (figure may show)", d.lifestyleLabel, "");
}

// ---- (c) Quick estimate done only: result view --------------------
{
  const q: QuickEstimateData = { ...qBase, monthlySpend: 10000, done: true };
  const d = lifestyleDisplayState(lifeBase, q, exBase);
  eq("c hasSpendingEvidence", d.hasSpendingEvidence, true);
  eq("c showResult", d.showResult, true);
  eq("c lifestyleAnnual", d.lifestyleAnnual, 120000);
  eq("c lifestyleLabel (figure may show)", d.lifestyleLabel, "");
}

// Confirmed lifestyle alone is also evidence (round-48 contract).
{
  const l: LifestyleData = { ...lifeBase, amounts: { food: 30000 }, confirmed: true };
  const d = lifestyleDisplayState(l, qBase, exBase);
  eq("c2 confirmed showResult", d.showResult, true);
  eq("c2 confirmed lifestyleAnnual", d.lifestyleAnnual, 30000);
}

// ---- (d) Group-1 exists but everything ends: lifestyle computes 0 --
// The result view may render (evidence exists) but the lifestyle
// figure itself must read "Not estimated yet", never $0.
{
  const l: LifestyleData = { ...lifeBase, amounts: { food: 12000 }, states: { food: "ends" } };
  const d = lifestyleDisplayState(l, qBase, exBase);
  eq("d hasSpendingEvidence", d.hasSpendingEvidence, true);
  eq("d showResult", d.showResult, true);
  eq("d lifestyleAnnual", d.lifestyleAnnual, 0);
  eq("d lifestyleLabel", d.lifestyleLabel, "Not estimated yet");
}

// Group totals split check (the helper the screen's card uses).
{
  const t = lifestyleGroupTotals({ ...lifeBase, amounts: { food: 12000, travel: 5000, k401: 41400, payroll_taxes: 9000 } });
  eq("totals group1", t.group1Total, 17000);
  eq("totals group2", t.group2Total, 50400);
}

// ---- Wizard write paths -------------------------------------------
// Step 1 "Quick estimate": completing the quick flow is what the
// wizard's Continue sees - chooseSpending must report tier "quick".
{
  const q: QuickEstimateData = { ...qBase, monthlySpend: 11000, done: true };
  const choice = chooseSpending({ lifestyle: lifeBase, exceptions: exBase, customAnnual: 0, budgetTotal: 0, quick: q, fallback: 341566 });
  eq("wizard step1 quick tier", choice.tier, "quick");
  eq("wizard step1 quick spending", choice.spendingAnnual, 132000);
  eq("wizard step1 quick evidence", lifestyleDisplayState(lifeBase, q, exBase).hasSpendingEvidence, true);
}

// Step 2 manual SS: the wizard writes members[].ssAnnual; ssForMember
// (the same reader Home and the page use) must return it as manual.
{
  const r = ssForMember({ id: "m1", ssAnnual: 45600 }, []);
  eq("wizard step2 manual SS annual", r.annual, 45600);
  eq("wizard step2 manual SS source", r.source, "manual");
}

// Step 3 "No": noPension is set ONLY when no pension data exists.
{
  eq("wizard step3 No, nothing on file -> flag allowed", pensionOnFile({ memberPensionAnnual: 0, householdPensionAnnual: 0, pensionStatementMonthly: 0 }), false);
  eq("wizard step3 No, member pension -> blocked", pensionOnFile({ memberPensionAnnual: 24000, householdPensionAnnual: 0, pensionStatementMonthly: 0 }), true);
  eq("wizard step3 No, household pension -> blocked", pensionOnFile({ memberPensionAnnual: 0, householdPensionAnnual: 18000, pensionStatementMonthly: 0 }), true);
  eq("wizard step3 No, pension statement -> blocked", pensionOnFile({ memberPensionAnnual: 0, householdPensionAnnual: 0, pensionStatementMonthly: 1500 }), true);
}

// ---- Owner harness (his device state, from the fixtures) ----------
// Accuracy X / missing 3 is asserted by the round-48 suite; here the
// Lifestyle display state for his data: entry view + know-so-far
// card, Group-2 fixture total 41,413.44/yr, no $0 lifestyle.
{
  const fx = JSON.parse(readFileSync("/home/hatch/workspace/hometower/prepared-payslips.json", "utf8"));
  const documents = fx.records;
  const jobs = [
    { memberName: "Assaf Harel", payFrequency: "semimonthly" },
    { memberName: "Yamit Harel", payFrequency: "semimonthly" },
  ];
  const k = payslip401kTotals(documents, "2026-11-08", jobs);
  ok("harness 401k totals exist", k !== null);
  const paceOf = (frag: string) => k!.perEarner.find((e) => e.name.includes(frag))?.monthlyPace ?? 0;
  near("harness Assaf pace", paceOf("Assaf"), 2384.44);
  near("harness Yamit pace", paceOf("Yamit"), 1066.68);
  const paceAnnual = k!.perEarner.reduce((s, e) => s + (e.monthlyPace ?? 0), 0) * 12;
  near("harness Group-2 fixture total/yr", paceAnnual, 41413.44);
  // The screen's prefill: the rounded annualized pace lands in the
  // k401 slot - and nothing else is in his lifestyle model.
  const prefill = Math.round(k!.perEarner.reduce((s, e) => s + (e.monthlyPace ?? 0), 0) * 12);
  eq("harness prefill", prefill, 41413);
  const l: LifestyleData = { ...lifeBase, amounts: { k401: prefill } };
  const d = lifestyleDisplayState(l, qBase, exBase);
  eq("harness showResult (entry view)", d.showResult, false);
  eq("harness hasSpendingEvidence", d.hasSpendingEvidence, false);
  eq("harness know-so-far total", d.group2Total, 41413);
  eq("harness lifestyle label (no $0 anywhere)", d.lifestyleLabel, "Not estimated yet");
  eq("harness computed lifestyle behind the guard", d.lifestyleAnnual, 0);
}

const total = pass + fail;
console.log(fail === 0 ? `ROUND50 OK ${pass}/${total}` : `ROUND50 FAILURES ${fail}/${total}`);
if (fail > 0) process.exit(1);
