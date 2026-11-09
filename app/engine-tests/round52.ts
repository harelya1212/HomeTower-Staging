// Round 52 acceptance: Copilot's directional outlook, provenance
// and navigation spec, implemented as written.
// GT1-GT4 the rating and range from the spec's exact reach triples;
// GT5 the staggered household timeline; GT6 statement-sourced
// employer match; GT7 unknown-never-zero; GT8 the placeholder
// directional face (range shown, no dollar target, no funded %);
// GT9 the recommended action is the searched saving. GT10 is
// navigation - verified by construction and by the served bundle's
// strings, not here. The owner harness runs his fixture state
// through the real card model (computeRetirementModel).
// Run: node engine-tests/round52.ts
import { readFileSync } from "node:fs";
import {
  deflateToToday,
  directionalOutlook,
  directionalProjected,
  docEvidenceStatus,
  employerMatchFor,
  faceStatusFor,
  k401StatementMatchFor,
  outlookRating,
  projectToCommonDate,
  reachRangeLabel,
  requiredPortfolioFor,
  statementPeriodMonths,
  valueStatusLabel,
  type DirectionalInput,
  type SsDocLike,
} from "../src/goals.ts";
import { payslip401kTotals, payslipDeductionTotals, payslipForecast } from "../src/payslips.ts";
import { computeRetirementModel } from "../src/retirementModel.ts";
import type { HouseholdState, UiMember } from "../src/store.tsx";
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
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

// ---- GT1-GT4: rating + range from the spec's reach triples --------
eq("GT1 rating", outlookRating(65, { r7: 61, r6: 62, r5: 64 }), "on_track");
eq("GT1 range", reachRangeLabel({ r7: 61, r6: 62, r5: 64 }), "61-64");
eq("GT2 rating", outlookRating(65, { r7: 64, r6: 65, r5: 68 }), "close");
eq("GT2 range", reachRangeLabel({ r7: 64, r6: 65, r5: 68 }), "64-68");
eq("GT3 rating", outlookRating(60, { r7: 64, r6: 66, r5: 69 }), "needs_improvement");
eq("GT3 range", reachRangeLabel({ r7: 64, r6: 66, r5: 69 }), "64-69");
eq("GT4 range", reachRangeLabel({ r7: 72, r6: 78, r5: null }), "72-80+");
eq("GT4 rating (none on time, earliest 7+ late)", outlookRating(65, { r7: 72, r6: 78, r5: null }), "off_track");
eq("range collapses to one age", reachRangeLabel({ r7: 63, r6: 63, r5: 63 }), "63");
eq("range when nothing reaches", reachRangeLabel({ r7: null, r6: null, r5: null }), "80+");
eq("rating: one on time", outlookRating(65, { r7: 65, r6: 70, r5: 75 }), "needs_improvement");
eq("rating: earliest 1 year late is Close", outlookRating(65, { r7: 66, r6: 70, r5: 75 }), "close");

// RequiredPortfolio (spec B): spending net of dependable, over the rate.
eq("required portfolio", requiredPortfolioFor(100000, 40000, 0.04), 1500000);
eq("required portfolio floors at 0", requiredPortfolioFor(30000, 40000, 0.04), 0);

// ---- GT5: staggered retirements, 2031 / 2041 -----------------------
// A retires in 5 years (2031), B in 15 (2041). A's contributions
// stop at year 5 while A's balance keeps growing to the common
// date; B contributes through 2041. directionalProjected must
// equal the manual projectToCommonDate composition, and must beat
// the (wrong) composition where B also stops at year 5.
{
  const input: DirectionalInput = {
    adults: [
      { name: "A", currentAge: 45, retireAge: 50, yearsToRetire: 5, startingBalance: 100000, monthly: 1000 },
      { name: "B", currentAge: 40, retireAge: 55, yearsToRetire: 15, startingBalance: 50000, monthly: 800 },
    ],
    spendingAnnual: 60000, dependableAnnual: 0, withdrawalRate: 0.04, inflationPct: 2.5, monthlyNet: 9000,
  };
  const got = directionalProjected(input, 0, 5, 6);
  const manual = deflateToToday(
    projectToCommonDate(100000, 1000, 5, 15, 6) + projectToCommonDate(50000, 800, 15, 15, 6),
    15, 2.5,
  );
  near("GT5 household composition (A stops 2031, grows; B through 2041)", got, manual, 0.01);
  const bStoppedEarly = deflateToToday(
    projectToCommonDate(100000, 1000, 5, 15, 6) + projectToCommonDate(50000, 800, 5, 15, 6),
    15, 2.5,
  );
  ok("GT5 B contributing through 2041 beats B stopping in 2031", got > bStoppedEarly);
  const aStopped = directionalProjected(input, 0, 5, 6);
  const aWorking = directionalProjected(input, 0, 15, 6);
  ok("GT5 delaying A past 2031 adds A's contributions", aWorking > aStopped);
}

// ---- GT6: statement-sourced employer match -------------------------
{
  const stmt: SsDocLike = {
    docType: "401k_statement", capturedOn: "2026-10-05", ownerMemberId: "a",
    fields: { employer_contribution_period: "1500", statement_period_months: "3", ending_balance: "50000" },
  };
  const m = k401StatementMatchFor([stmt], "a");
  ok("GT6 statement match found", m !== null);
  eq("GT6 period total", m!.periodTotal, 1500);
  eq("GT6 months from the statement's own field", m!.months, 3);
  eq("GT6 monthly match = 1500 / 3", m!.monthly, 500);
  const res = employerMatchFor({ payslipMonthly: null, statement: m });
  eq("GT6 resolved monthly", res.monthly, 500);
  eq("GT6 resolved status", res.status, "from_statement");
  eq("GT6 source displays From statement", res.sourceLabel, "From statement");

  // Same derivation from a period RANGE string on the statement.
  const ranged: SsDocLike = {
    docType: "401k_statement", capturedOn: "2026-10-05", ownerMemberId: "a",
    fields: { employer_contributions: "1500", statement_period: "07/01/2026 - 09/30/2026" },
  };
  eq("GT6 months from a period range", statementPeriodMonths(ranged.fields!), 3);
  eq("GT6 monthly from a period range", k401StatementMatchFor([ranged], "a")!.monthly, 500);

  // AC-D1: a payslip match beats the statement.
  const resPayslip = employerMatchFor({ payslipMonthly: 300, statement: m });
  eq("AC-D1 payslip match wins", resPayslip.monthly, 300);
  eq("AC-D1 payslip status", resPayslip.status, "from_payslip");

  // AC-D3: a statement with no identified owner is never used.
  const unowned: SsDocLike = { docType: "401k_statement", capturedOn: "2026-10-05", ownerMemberId: null, fields: { employer_contribution_period: "1500", statement_period_months: "3" } };
  eq("AC-D3 unowned statement unused", k401StatementMatchFor([unowned], "a"), null);
  eq("AC-D3 another member's statement unused", k401StatementMatchFor([stmt], "b"), null);

  // Detected but not paced: a total with no period anywhere is
  // reported as detected - a pace is never guessed.
  const noPeriod: SsDocLike = { docType: "401k_statement", capturedOn: "2026-10-05", ownerMemberId: "a", fields: { employer_contributions: "1500" } };
  const mNp = k401StatementMatchFor([noPeriod], "a");
  eq("detected-not-paced monthly is null", mNp!.monthly, null);
  const resNp = employerMatchFor({ payslipMonthly: null, statement: mNp });
  eq("detected-not-paced flag", resNp.detectedNotPaced, true);
  eq("detected-not-paced status", resNp.status, "not_detected");

  // AC-D4: nothing anywhere -> Unknown, and the label is the word,
  // not a $0.
  const resUnknown = employerMatchFor({ payslipMonthly: null, statement: null });
  eq("AC-D4 unknown status", resUnknown.status, "unknown");
  eq("AC-D4 unknown label", valueStatusLabel(resUnknown.status), "Unknown");
  const resNd = employerMatchFor({ payslipMonthly: null, statement: null, relevantDocsExist: true });
  eq("AC-D4 not-detected when documents exist", resNd.status, "not_detected");
}

// ---- GT7: ESPP not found -> Unknown, never $0 -----------------------
{
  eq("GT7 no documents at all", docEvidenceStatus([], "espp"), "unknown");
  eq("GT7 label is the word Unknown", valueStatusLabel(docEvidenceStatus([], "espp")), "Unknown");
  const bareSlip: SsDocLike = { docType: "payslip", capturedOn: "2026-11-01", fields: { employee_name: "Earner A", k401_contribution: "500" } };
  eq("GT7 slips exist, ESPP absent", docEvidenceStatus([bareSlip], "espp"), "not_detected");
  eq("GT7 hsa with no documents", docEvidenceStatus([], "hsa"), "unknown");
  eq("GT7 529 with no statements", docEvidenceStatus([], "529"), "unknown");
  eq("GT7 match with no documents", docEvidenceStatus([], "match"), "unknown");
}

// ---- GT9: the recommended action is the searched saving -------------
// Desired 60, base (6%) reach 64; saving $900/mo more reaches 60,
// and $900 is under 10% of the $15,000 monthly net - so the saving
// is THE recommended action (spec E, AC-C5 shape).
{
  const input: DirectionalInput = {
    adults: [{ name: "Solo", currentAge: 50, retireAge: 60, yearsToRetire: 10, startingBalance: 100000, monthly: 1900 }],
    spendingAnnual: 20000, dependableAnnual: 0, withdrawalRate: 0.04, inflationPct: 2.5, monthlyNet: 15000,
  };
  const out = directionalOutlook(input, money);
  ok("GT9 sufficient", out.sufficient);
  eq("GT9 desired age", out.desiredAge, 60);
  eq("GT9 base reach (6%)", out.reach.r6, 64);
  eq("GT9 lever A is the $900 saving", out.levers.saveMonthly, 900);
  eq("GT9 action kind", out.action.kind, "save");
  ok("GT9 action text names the saving", out.action.text.includes("$900"));
  ok("GT9 impact recomputes the range", out.action.impactText.startsWith("Estimated current path improves from"));
  eq("GT9 rating", out.rating, "needs_improvement");
}

// Insufficient data: no balance AND no pace -> Not enough data,
// never an invented range (spec C).
{
  const input: DirectionalInput = {
    adults: [{ name: "Solo", currentAge: 50, retireAge: 60, yearsToRetire: 10, startingBalance: 0, monthly: 0 }],
    spendingAnnual: 50000, dependableAnnual: 0, withdrawalRate: 0.04, inflationPct: 2.5, monthlyNet: 8000,
  };
  const out = directionalOutlook(input, money);
  eq("insufficient: not sufficient", out.sufficient, false);
  eq("insufficient: rating", out.rating, "not_enough_data");
  eq("insufficient: label", out.ratingLabel, "Not enough data");
  // Pace alone IS a path (the owner's own fixture state).
  const paceOnly: DirectionalInput = { ...input, adults: [{ ...input.adults[0], monthly: 500 }] };
  eq("pace-only state is sufficient", directionalOutlook(paceOnly, money).sufficient, true);
}

// ---- Owner harness: his fixture state through the real card model --
// Five payslips, nothing personalized, accuracy X (the round-48/51
// harness state). Before round 52 the X face said only "Not ready
// to score". The directional face must now answer - desired age,
// current-path range, rating, one recommended action - with no
// dollar target and no funded % anywhere on the face model (GT8).
{
  const fx = JSON.parse(readFileSync("/home/hatch/workspace/hometower/prepared-payslips.json", "utf8"));
  const documents = fx.records as DocumentRecord[];
  const today = "2026-11-08";
  const member = (id: string, name: string, role: "self" | "spouse", dob: string, retireAge: number): UiMember => ({
    id, name, role, dob, retireAge, retireTarget: 0, ssAnnual: 0, ssClaimAge: 67, retireFlex: "fixed",
    pensionAnnual: 0, eduTarget: 0, studentNow: false, collegeStartYear: 0, yearsLeftInCollege: 0,
    eduBalance: 0, eduMonthly: 0, eduAnnualCost: 0, eduInState: true, eduRoomBoard: true,
    eduScholarshipYear: 0, eduDurationYears: 4,
  });
  // The default household state, inlined (store.tsx itself is a
  // React module and cannot load under plain node): nothing
  // personalized anywhere - the round-48/51 harness state exactly.
  const state = {
    intake: { name: "Harel", state: "AZ", filingStatus: "married_filing_jointly", members: [], documents },
    grossIncome: 0, federalWithholdingYtd: 0, stateWithholdingYtd: 0, ltcgIncome: 0,
    goals: {
      retirementBalance: 0, retirementMonthly: 0, retirementYears: 10, retirementTarget: 0,
      eduBalance: 0, eduMonthly: 0, eduYears: 5, eduTarget: 0, assumedReturnPct: 6,
      stateRefundTargetLow: 1000, stateRefundTargetHigh: 3000, pensionAnnual: 0,
      otherRetirementIncomeAnnual: 0, retirementSpendingAnnual: 0, spendingMode: "estimate",
      retirementBudget: { housing: 0, food: 0, healthcare: 0, travel: 0, other: 0 },
      inflationPct: 2.5, noPension: false,
      lifestyle: { amounts: {}, states: {}, adjusted: {}, additionsAnnual: 0, confirmed: false },
      quickEstimate: { monthlySpend: 0, mortgageEndsMonthly: 0, collegeEndsAnnual: 0, travelAdjustPct: 0, healthcareBridgeAnnual: 0, done: false },
      exceptions: { mortgageAtRetirement: "", mortgageMonthly: 0, collegeContinuesAnnual: 0, healthcareBridgeAnnual: 0, majorChangeAnnual: 0, travel: "" },
    },
    family: [member("a", "Assaf Harel", "self", "1977-09-26", 60), member("y", "Yamit Harel", "spouse", "1978-05-15", 50)],
    jobs: [
      { id: "j1", memberName: "Assaf Harel", employer: "", startDate: "", endDate: "", payFrequency: "semimonthly" },
      { id: "j2", memberName: "Yamit Harel", employer: "", startDate: "", endDate: "", payFrequency: "semimonthly" },
    ],
    assets: [], events: [],
  } as unknown as HouseholdState;
  const slipFc = payslipForecast(documents, state.family, state.jobs, today);
  ok("harness forecast exists", slipFc !== null);
  const k = payslip401kTotals(documents, today, state.jobs);
  const model = computeRetirementModel({
    state, today, slipFc, k401Totals: k, retBalance: 0, retMonthly: 0,
    effIncome: slipFc ? slipFc.projectedTaxable : 0, moneyFmt: money,
  });
  // The pre-round-52 model is untouched (rounds 48-51 figures).
  eq("harness accuracy still X", model.accuracy.level, "X");
  eq("harness spending tier still none (placeholder)", model.spendingTier, "none");
  eq("harness placeholder spending", model.spendingAnnual, 341566);
  eq("harness projected (today's $) unchanged", Math.round(model.projectedToday), 374033);
  eq("harness need unchanged", model.hhRet.needBase, 8539150);
  // The directional answer on the same state.
  const d = model.directional!;
  ok("harness directional sufficient (pace-only state)", d.sufficient);
  eq("harness reference adult is the earlier retirer (Yamit)", d.referenceIndex, 1);
  eq("harness desired age", d.desiredAge, 50);
  eq("harness current-path range", d.rangeLabel, "80+");
  eq("harness base reach (6%)", d.reach.r6, null);
  eq("harness rating", d.rating, "off_track");
  eq("harness rating label", d.ratingLabel, "Current path misses target");
  // GT8: the face model - exactly the fields HomeScreen's X
  // directional branch renders. No dollar target, no funded %.
  // ROUND 53 SUPERSEDES THE FACE SHAPE (Copilot's device feedback):
  // a visual status card - the status line (an off-track rating is
  // softened to "Too early to confirm" on the X face only), two big
  // numbers, the timeline, one opportunity line, one action - and
  // NO Recommended line and no paragraph text. The four assertions
  // below are unchanged in substance.
  const disp = faceStatusFor(model.accuracy.level, d.rating, d.desiredAge);
  const face = {
    title: "Retirement outlook",
    status: disp.label,
    support: disp.support,
    confidence: "Early estimate - Low confidence",
    desired: d.desiredAge,
    currentPath: d.rangeLabel,
    timeline: model.timeline !== null,
    opportunity: model.opportunityLine,
    cta: "Improve estimate",
  };
  ok("GT8 face shows the range", face.currentPath.includes("80+"));
  ok("GT8 face has no target field", !("target" in face) && !Object.values(face).some((v) => String(v).includes("target $") || String(v).includes("Target:")));
  ok("GT8 face has no funded %", !Object.values(face).some((v) => String(v).includes("%") && String(v).toLowerCase().includes("fund")));
  ok("GT8 face carries no readiness figure", !("readiness" in face));
  console.log(`     harness directional: desired ${d.desiredAge}, range ${d.rangeLabel}, rating ${d.ratingLabel}, action [${d.action.kind}] "${d.action.text}" impact "${d.action.impactText}" levers save=${d.levers.saveMonthly} later=${d.levers.yearsLater} spend=${d.levers.spendingCutAnnual} monthlyNet=${Math.round(model.monthlyNet)}`);

  // GT7 on his real documents: ESPP and HSA ARE on the payslips;
  // the match is not - Not detected, never $0.
  const docsLike = documents as unknown as SsDocLike[];
  eq("harness ESPP from payslips", docEvidenceStatus(docsLike, "espp"), "from_payslip");
  eq("harness HSA from payslips", docEvidenceStatus(docsLike, "hsa"), "from_payslip");
  eq("harness match not detected (not $0)", docEvidenceStatus(docsLike, "match"), "not_detected");
  const ded = payslipDeductionTotals(documents, today, state.jobs);
  ok("harness deduction totals exist", ded !== null);
  near("harness ESPP YTD (freshest per earner)", ded!.esppYtd, 33903.38, 0.02);
  near("harness ESPP pace", ded!.esppMonthlyPace ?? 0, 3434.20, 0.02);
  near("harness HSA YTD", ded!.hsaYtd, 5454.63, 0.02);
  near("harness HSA pace (Assaf only)", ded!.hsaMonthlyPace ?? 0, 89.30, 0.02);
}

const total = pass + fail;
console.log(fail === 0 ? `ROUND52 OK ${pass}/${total}` : `ROUND52 FAILURES ${fail}/${total}`);
if (fail > 0) process.exit(1);
