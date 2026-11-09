// Round 59 - device-QA defects from the owner's 2026-11-09 upload
// session, plus Copilot's review of the same session (album
// 045lgGQW). Seven traces:
//  A - the HSA screenshot failed on device for the THIRD time:
//      the proximity page read was gated on the type being known
//      first, so the automatic path could never reach it; wide
//      images had no retry pass (bands refuse them); a text-read
//      but unmatched image ended on a note with no card. OCR
//      fixtures below are the app's OWN pinned stack (tesseract.js
//      5.0.5 + its pinned language data) on the owner's real
//      screenshot and on degraded variants of it - see
//      round59-harness.ts for how they were produced.
//  B - a pre-round-58 5498-SA rendered twice after re-upload:
//      identity ladder hardened (figure-fallback keys) + a
//      load-time dedupe sweep heals pairs already stored.
//  C - the HSA card blended both earners' payroll YTD into one
//      figure and annualized the pace at 26 periods (a job record
//      still carrying the form's biweekly default) against a
//      semi-monthly truth: frequency resolves from the slips'
//      own period ends, and the card reconciles per owner
//      against the statement (Copilot's remedy shape).
//  D - the 529 headline showed ONE child's pace (whichever
//      record iterated last): per-child freshest, summed.
//  E - the 401(k) match pace (a derivation from the confirmed
//      YTD) was presented as stated data: confirmed YTD first,
//      pace labelled derived.
//  F - education gaps rendered as red verdicts on DEFAULT
//      costs: per-child early-estimate gating, like Retirement's.
//  G - at accuracy X the retirement card shouted "80+" beside
//      "Too early to confirm": the Home tile and timeline
//      callout use words at X; details keep the numeric model.
// Run: node engine-tests/round59.ts
import { readFileSync } from "node:fs";
import { classifyDocument } from "../engine/classify.ts";
import { extractFields } from "../engine/extract.ts";
import type { DocumentRecord } from "../engine/intake.ts";
import { ocrMapsPack } from "../engine/packs.ts";
import { educationOutlookFor, k401StatementMatchFor, statementMatchLine } from "../src/goals.ts";
import { payslip401kTotals, payslipDeductionTotals, payslipForecast, periodsPerYearForEarner } from "../src/payslips.ts";
import {
  dedupeStoredDocuments, eduMonthlyTotal, fallbackKeyFor, hsaContributionReconciliation,
  reprocessDocuments, semanticKeyFor, upsertDocument,
} from "../src/reconcile.ts";
import { computeRetirementModel } from "../src/retirementModel.ts";
import type { HouseholdState, UiMember } from "../src/store.tsx";
import { hsaPageDetectedFields } from "../src/statementSections.ts";
import { isEmptyRead, textToRawFields, unmatchedExcerpt } from "../src/textFields.ts";
import { wideRetryScale, WIDE_RETRY_TARGET_WIDTH } from "../src/webOcr.ts";

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
}
function ok(name: string, cond: boolean) {
  if (cond) pass++; else { fail++; console.log(`FAIL ${name}`); }
}
const money = (n: number) => `$${Math.round(n)}`;
const FIX = "/home/hatch/workspace/hometower-staging/app/engine-tests/fixtures";
const MAPS = String(ocrMapsPack().version ?? "");

// ---------------------------------------------------------------------------
// TRACE A - the HSA page signature, the ladder, the honest card
// ---------------------------------------------------------------------------
{
  const original = readFileSync(`${FIX}/round59-hsa-page-ocr.txt`, "utf8");
  const generic = extractFields(textToRawFields(original), classifyDocument(textToRawFields(original), original).docType);
  eq("A: the classifier alone misses the page (the device symptom)", classifyDocument(textToRawFields(original), original).docType, "other");
  eq("A: the generic read finds no balance (why the old gate failed)", generic.fields["ending_balance"] ?? null, null);
  const page = hsaPageDetectedFields(original);
  ok("A: the page signature holds on the real read", page !== null);
  eq("A: the ungated page read resolves the balance", extractFields(page!, "hsa_statement").fields["ending_balance"], 13769.61);

  const half = readFileSync(`${FIX}/round59-hsa-page-half-ocr.txt`, "utf8");
  eq("A: the half-size read forms no pairs (the pairless signature)", textToRawFields(half).length, 0);
  eq("A: the half-size read is NOT an empty read (unmatched card, not empty card)", isEmptyRead(half), false);
  eq("A: the half-size read has no page signature", hsaPageDetectedFields(half), null);

  const halfUp = readFileSync(`${FIX}/round59-hsa-page-half-up4x-ocr.txt`, "utf8");
  const pageUp = hsaPageDetectedFields(halfUp);
  ok("A: the enlarged re-read restores the page signature", pageUp !== null);
  eq("A: the enlarged re-read resolves the same balance", extractFields(pageUp!, "hsa_statement").fields["ending_balance"], 13769.61);

  const corrupted = readFileSync(`${FIX}/round59-hsa-page-half-q60-up4x-ocr.txt`, "utf8");
  eq("A: the q60-degraded enlarged read stays honestly unmatched (figure corrupted beyond recognition)", hsaPageDetectedFields(corrupted), null);

  eq("A: ladder - half-width wide image enlarges to the target", Math.round(wideRetryScale(645, 341) * 645), WIDE_RETRY_TARGET_WIDTH);
  eq("A: ladder - the real screenshot (1290 wide) enlarges", Math.round(wideRetryScale(1290, 681) * 1290), WIDE_RETRY_TARGET_WIDTH);
  eq("A: ladder - already at target width: no pass", wideRetryScale(2600, 1400), 0);
  eq("A: ladder - above target: no pass", wideRetryScale(3000, 1500), 0);
  eq("A: ladder - tall images belong to the band path", wideRetryScale(800, 2400), 0);
  eq("A: ladder - unknown size: no pass", wideRetryScale(0, 0), 0);

  eq("A: excerpt folds whitespace", unmatchedExcerpt("line one\n\n  line   two"), "line one line two");
  eq("A: excerpt caps at 200 chars plus ellipsis", unmatchedExcerpt("x".repeat(250)).length, 203);
  eq("A: the empty read stays the empty read", isEmptyRead("  \n "), true);
}

// ---------------------------------------------------------------------------
// TRACE B - legacy-shape dedupe + the load sweep
// ---------------------------------------------------------------------------
const FORM_TEXT = [
  "Form 5498-SA Health Savings Account",
  "2025", "Account: 231-851100", "Assaf Harel",
  "2 Total contributions made in 2025 8,544.00",
  "5 Fair market value of HSA 15,051.63",
].join("\n") + "\n" + "Fidelity Investments filler text so the retained reading clears the fingerprint minimum length easily.";
const freshSa = (type: "hsa_5498_sa" | "hsa_1099_sa", withAcct: boolean): DocumentRecord => ({
  docType: type, status: "parsed", confidence: 0.9, capturedOn: "2026-11-09",
  fields: type === "hsa_5498_sa"
    ? { tax_year: "2025", ...(withAcct ? { account_id: "231-851100" } : {}), account_owner: "Assaf Harel", source_date: "2026-05-10", box_1_employee_contributions: "8544", box_2_total_contributions: "8544", box_3_contributions_made_next_year: "0", box_4_rollover_contributions: "0", box_5_fair_market_value: "15051.63", box_6_account_type: "HSA", box_2: "8544", box_3: "0", box_4: "0", box_5: "15051.63", box_6: "HSA" }
    : { tax_year: "2025", ...(withAcct ? { account_id: "231-851100-001" } : {}), account_owner: "Assaf Harel", source_date: "2026-01-30", box_1_gross_distribution: "7743.99", box_2_earnings_on_excess: "0", box_3_distribution_code: "1", box_4_fmv_on_date_of_death: "0", box_5_account_type: "HSA", box_1: "7743.99", box_2: "0", box_3: "1", box_4: "0", box_5: "HSA" },
  rawText: FORM_TEXT, mapsVersion: MAPS, extractorVersion: 2,
});
{
  // (i) The straightforward pre-round-58 shape (fields as the
  // round-55/57 save wrote them, text retained, no stamps):
  // reprocess + upsert refresh - this shape already deduped,
  // pinned so it cannot regress.
  const legacy: DocumentRecord = {
    docType: "hsa_5498_sa", status: "parsed", confidence: 0.9, capturedOn: "2026-11-09",
    fields: { ...freshSa("hsa_5498_sa", true).fields }, rawText: FORM_TEXT, mapsVersion: "1.13",
  };
  const rep = reprocessDocuments([legacy], [], MAPS);
  const up = upsertDocument(rep.docs, freshSa("hsa_5498_sa", true));
  eq("B: round-55-shaped record + re-upload = one record", up.docs.length, 1);
  eq("B: round-55-shaped record refreshes in place", up.refreshed, true);

  // (ii) The blinder legacy shape: no retained text, no account_id
  // anywhere - fingerprint blind, primary key computes acct:"".
  // The figure-fallback key is what catches it now.
  const blind: DocumentRecord = {
    docType: "hsa_5498_sa", status: "parsed", confidence: 0.9, capturedOn: "2026-11-08",
    fields: { tax_year: "2025", box_2_total_contributions: "8544", box_5_fair_market_value: "15051.63" },
  };
  ok("B: the blind shape's primary key cannot match the fresh key", semanticKeyFor(blind) !== semanticKeyFor(freshSa("hsa_5498_sa", true)));
  eq("B: the blind shape's fallback key equals the fresh one", fallbackKeyFor(blind), fallbackKeyFor(freshSa("hsa_5498_sa", true)));
  const up2 = upsertDocument([blind], freshSa("hsa_5498_sa", true));
  eq("B: blind legacy 5498 + re-upload = one record", up2.docs.length, 1);
  eq("B: blind legacy 5498 refreshes via the fallback key", up2.refreshed, true);

  // (iii) The pair already sitting in stored state heals on load.
  const pair = dedupeStoredDocuments([blind, freshSa("hsa_5498_sa", true)]);
  eq("B: the stored duplicate pair merges on load", pair.docs.length, 1);
  eq("B: the sweep reports the merge", pair.merged, 1);
  eq("B: the survivor carries the fuller reading's account", pair.docs[0].fields?.["account_id"], "231-851100");

  // (iv) The same audit on the other keys.
  const blind1099: DocumentRecord = {
    docType: "hsa_1099_sa", status: "parsed", confidence: 0.9, capturedOn: "2026-11-08",
    fields: { tax_year: "2025", box_1_gross_distribution: "7743.99", box_3_distribution_code: "1" },
  };
  eq("B: blind legacy 1099 + re-upload = one record", upsertDocument([blind1099], freshSa("hsa_1099_sa", true)).docs.length, 1);
  const blind401: DocumentRecord = {
    docType: "401k_statement", status: "parsed", capturedOn: "2026-11-08",
    fields: { statement_as_of: "2026-11-06", ending_balance: "271019.12" },
  };
  const fresh401: DocumentRecord = {
    docType: "401k_statement", status: "parsed", capturedOn: "2026-11-09", ownerMemberId: "assaf",
    fields: { statement_as_of: "2026-11-06", ending_balance: "271019.12", your_contributions_ytd: "30510.46" },
  };
  eq("B: ownerless legacy 401k + owned re-upload = one record", upsertDocument([blind401], fresh401).docs.length, 1);
  const other401: DocumentRecord = {
    docType: "401k_statement", status: "parsed", capturedOn: "2026-11-09", ownerMemberId: "yamit",
    fields: { statement_as_of: "2026-11-06", ending_balance: "90210.55" },
  };
  eq("B: a DIFFERENT 401k (same period, different balance) never merges", upsertDocument([blind401], other401).docs.length, 2);
  const blindSection: DocumentRecord = {
    docType: "529_statement", status: "parsed", capturedOn: "2026-11-08", ownerMemberId: "ella",
    fields: { statement_as_of: "2026-10-31", ending_balance: "16819.52", beneficiary_name: "Ella Harel" },
  };
  const freshSection: DocumentRecord = { ...blindSection, capturedOn: "2026-11-09", accountId: "618-579537", fields: { ...blindSection.fields, monthly_contribution: "200" } };
  eq("B: account-less legacy section + re-upload = one record", upsertDocument([blindSection], freshSection).docs.length, 1);
  const other5498: DocumentRecord = {
    docType: "hsa_5498_sa", status: "parsed", capturedOn: "2026-11-09",
    fields: { tax_year: "2025", account_id: "999-111222", box_2_total_contributions: "4000", box_5_fair_market_value: "9000" },
  };
  eq("B: a DIFFERENT 5498 (different figures) never merges", upsertDocument([blind], other5498).docs.length, 2);
  eq("B: the sweep leaves distinct documents alone", dedupeStoredDocuments([blind, other5498, blind1099]).docs.length, 3);
}

// ---------------------------------------------------------------------------
// TRACE C - frequency from the slips, reconciliation per owner
// ---------------------------------------------------------------------------
const fx = JSON.parse(readFileSync("/home/hatch/workspace/hometower/prepared-payslips.json", "utf8"));
const slips = fx.records as DocumentRecord[];
const family59 = [
  { id: "assaf", name: "Assaf Harel", role: "self" },
  { id: "yamit", name: "Yamit Harel", role: "spouse" },
  { id: "shahar", name: "Shahar Harel", role: "child" },
  { id: "ella", name: "Ella Harel", role: "child" },
  { id: "anat", name: "Anat Harel", role: "child" },
];
{
  eq("C: 15th + month-end ends = semi-monthly, whatever the job record says", periodsPerYearForEarner(["2026-10-15", "2026-10-31"], "biweekly"), 24);
  eq("C: 14-day spacing = biweekly", periodsPerYearForEarner(["2026-10-02", "2026-10-16", "2026-10-30"], null), 26);
  eq("C: 7-day spacing = weekly", periodsPerYearForEarner(["2026-10-05", "2026-10-12", "2026-10-19"], null), 52);
  eq("C: month-ends across months = monthly", periodsPerYearForEarner(["2026-09-30", "2026-10-31"], null), 12);
  eq("C: one slip is indecisive - the job record decides", periodsPerYearForEarner(["2026-10-31"], "biweekly"), 26);
  eq("C: one slip, no job record - the standing default", periodsPerYearForEarner(["2026-10-31"], null), 24);
  eq("C: no slips at all - the standing default", periodsPerYearForEarner([], null), 24);

  const deviceJobs = [
    { memberName: "Assaf Harel", payFrequency: "biweekly" },
    { memberName: "Yamit Harel", payFrequency: "biweekly" },
  ];
  const totals = payslipDeductionTotals(slips, "2026-11-09", deviceJobs);
  const assaf = totals.perEarner.find((e) => e.name.includes("Assaf"))!;
  const yamit = totals.perEarner.find((e) => e.name.includes("Yamit"))!;
  eq("C: Assaf payroll HSA YTD is his freshest snapshot, not a sum", assaf.hsaYtd, 3621.33);
  eq("C: Assaf pace at the real semi-monthly frequency (never $97)", assaf.hsaMonthlyPace, 89.3);
  eq("C: Yamit payroll HSA YTD from her own slips", yamit.hsaYtd, 1833.3);
  eq("C: household YTD is the two earners' resolved snapshots", totals.hsaYtd, 5454.63);
  eq("C: household pace counts only earners with a per-period figure", totals.hsaMonthlyPace, 89.3);
  const k = payslip401kTotals(slips, "2026-11-09", deviceJobs)!;
  eq("C: the 401(k) pace uses the same resolved frequency", k.perEarner.find((e) => e.name.includes("Assaf"))!.monthlyPace, 2384.44);
  eq("C: 401(k) totals unchanged", k.total, 33685.47);

  const hsaStmt: DocumentRecord = {
    docType: "hsa_statement", status: "parsed", capturedOn: "2026-11-09", ownerMemberId: "assaf", accountId: "231-851100",
    fields: { statement_as_of: "2026-10-31", ending_balance: "13808.57", contributions_ytd: "3621.33", contributions_period: "89.30", monthly_contribution: "89.30" },
  };
  const recon = hsaContributionReconciliation([...slips, hsaStmt], totals.perEarner, family59);
  eq("C: recon owner", recon.ownerName, "Assaf Harel");
  eq("C: recon owner payroll YTD", recon.ownerPayrollYtd, 3621.33);
  eq("C: recon other household YTD (the second earner, on her own line)", recon.otherHouseholdYtd, 1833.3);
  eq("C: recon statement confirmed YTD", recon.statementYtd, 3621.33);
  eq("C: recon delta is zero when payroll and statement agree", recon.delta, 0);
  eq("C: recon explained - the badge stands", recon.explained, true);
  const offStmt: DocumentRecord = { ...hsaStmt, fields: { ...hsaStmt.fields, contributions_ytd: "3500" } };
  const reconOff = hsaContributionReconciliation([...slips, offStmt], totals.perEarner, family59);
  eq("C: recon delta names the true residual", reconOff.delta, 121.33);
  eq("C: an unexplained delta flips the badge state", reconOff.explained, false);
  const reconNone = hsaContributionReconciliation(slips, totals.perEarner, family59);
  eq("C: no statement on file - nothing to reconcile", reconNone.delta, null);
  eq("C: no statement on file - no false alarm", reconNone.explained, true);
}

// ---------------------------------------------------------------------------
// TRACE D - the 529 headline pace
// ---------------------------------------------------------------------------
{
  const section = (childId: string, monthly: string, asOf: string, bal: string): DocumentRecord => ({
    docType: "529_statement", status: "parsed", capturedOn: "2026-11-09", ownerMemberId: childId,
    fields: { statement_as_of: asOf, monthly_contribution: monthly, ending_balance: bal },
  });
  const kids = family59.filter((m) => m.role === "child");
  const three = [section("shahar", "350", "2026-10-31", "4324.04"), section("ella", "200", "2026-10-31", "16819.52"), section("anat", "150", "2026-10-31", "12007.40")];
  const total = eduMonthlyTotal(three, kids);
  eq("D: the headline is the household sum across children", total.total, 700);
  eq("D: per-child paces all present", total.perChild.map((p) => p.monthly), [350, 200, 150]);
  eq("D: one child = that child's pace", eduMonthlyTotal([three[0]], kids).total, 350);
  const fresher = [...three, section("shahar", "400", "2026-11-30", "4700")];
  eq("D: a fresher statement replaces the child's pace, never adds", eduMonthlyTotal(fresher, kids).total, 750);
  eq("D: no statements = no pace", eduMonthlyTotal([], kids).total, 0);
}

// ---------------------------------------------------------------------------
// TRACE E - match provenance wording
// ---------------------------------------------------------------------------
{
  const stmt = k401StatementMatchFor([{
    docType: "401k_statement", status: "parsed", capturedOn: "2026-11-09", ownerMemberId: "assaf",
    fields: { statement_as_of: "2026-11-06", ending_balance: "271019.12", employer_contribution_period: "11466.08", statement_period_months: "10" },
  }], "assaf");
  ok("E: the statement match resolves", stmt !== null);
  eq("E: confirmed YTD is the statement's own figure", stmt!.periodTotal, 11466.08);
  eq("E: the pace is the YTD over the statement's 10 months", stmt!.monthly, 1146.61);
  const line = statementMatchLine({ periodTotal: stmt!.periodTotal, months: stmt!.months, monthly: stmt!.monthly, statementLabel: "November 2026" });
  ok("E: the line leads with the confirmed YTD", line.startsWith("Employer match YTD: $11,466 confirmed"));
  ok("E: the pace is labelled estimated", line.includes("Estimated pace: ~$1,147/mo"));
  ok("E: the source is labelled a derivation", line.includes("statement -> derived pace"));
  ok("E: the old bare-source form is gone", !line.includes("Employer match: $1,147/mo"));
}

// ---------------------------------------------------------------------------
// TRACE F - education accuracy gating, per child
// ---------------------------------------------------------------------------
{
  const kid = (id: string, name: string, dob: string, extra: Partial<UiMember>): UiMember => ({
    id, name, role: "child", dob, retireAge: 67, retireTarget: 0, ssAnnual: 0, ssClaimAge: 67, retireFlex: "fixed",
    pensionAnnual: 0, eduTarget: 0, studentNow: false, collegeStartYear: 0, yearsLeftInCollege: 0,
    eduBalance: 0, eduMonthly: 0, eduAnnualCost: 0, eduInState: true, eduRoomBoard: true,
    eduScholarshipYear: 0, eduDurationYears: 4, ...extra,
  } as UiMember);
  const kids = [
    kid("shahar", "Shahar Harel", "2007-06-01", { studentNow: true, yearsLeftInCollege: 3, eduBalance: 4324.04, eduMonthly: 350 }),
    kid("ella", "Ella Harel", "2009-03-01", { collegeStartYear: 2027, eduBalance: 16819.52, eduMonthly: 200 }),
    kid("anat", "Anat Harel", "2013-09-01", { collegeStartYear: 2031, eduBalance: 12007.4, eduMonthly: 150 }),
  ];
  const outlook = educationOutlookFor(kids, "2026-11-09", 6, 24000);
  eq("F: all-default costs - every child is early-estimate", outlook.map((o) => o.earlyEstimate), [true, true, true]);
  eq("F: all-default costs - no child carries a verdict status", outlook.map((o) => o.status), ["early", "early", "early"]);
  ok("F: the arithmetic still shows in early mode (gaps computed, just not verdicts)", outlook.every((o) => o.funding.gap > 0));
  const upgraded = educationOutlookFor(kids.map((c) => (c.id === "ella" ? { ...c, eduAnnualCost: 95000 } : c)), "2026-11-09", 6, 24000);
  eq("F: real costs upgrade that child alone", upgraded.map((o) => o.status), ["early", "gap", "early"]);
  eq("F: the upgraded child is no longer early", upgraded[1].earlyEstimate, false);
}

// ---------------------------------------------------------------------------
// TRACE G - the X face drops the numeric 80+
// ---------------------------------------------------------------------------
{
  const member = (id: string, name: string, role: "self" | "spouse", dob: string, retireAge: number): UiMember => ({
    id, name, role, dob, retireAge, retireTarget: 0, ssAnnual: 0, ssClaimAge: 67, retireFlex: "fixed",
    pensionAnnual: 0, eduTarget: 0, studentNow: false, collegeStartYear: 0, yearsLeftInCollege: 0,
    eduBalance: 0, eduMonthly: 0, eduAnnualCost: 0, eduInState: true, eduRoomBoard: true,
    eduScholarshipYear: 0, eduDurationYears: 4,
  } as UiMember);
  const state = {
    intake: { name: "Harel", state: "AZ", filingStatus: "married_filing_jointly", members: [], documents: slips },
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
  const slipFc = payslipForecast(slips, state.family, state.jobs, "2026-11-08");
  const model = computeRetirementModel({
    state, today: "2026-11-08", slipFc, k401Totals: payslip401kTotals(slips, "2026-11-08", state.jobs),
    retBalance: 0, retMonthly: 0, effIncome: slipFc ? slipFc.projectedTaxable : 0, moneyFmt: money,
  });
  eq("G: the fixture household is accuracy X", model.accuracy.level, "X");
  eq("G: the details model keeps the numeric range", model.directional!.rangeLabel, "80+");
  eq("G: the Home tile at X is words, not the number", model.homeRangeLabel, "Outside current estimate range");
  const homeJson = JSON.stringify({ tile: model.homeRangeLabel, timeline: model.homeTimeline });
  ok("G: no 80+ anywhere in the Home tile or timeline callout at X", !homeJson.includes("80+"));
  ok("G: the unreached band still draws at X", model.homeTimeline!.band.unreached === true);
  ok("G: the Goal label survives at X", model.homeTimeline!.labels.some((l) => l.kind === "goal" && l.text === "Goal 50"));
  ok("G: decade ticks survive at X", model.homeTimeline!.labels.some((l) => l.text === "60") && model.homeTimeline!.labels.some((l) => l.text === "70"));

  const statePlus = { ...state, family: state.family.map((m) => (m.id === "a" ? { ...m, ssAnnual: 36000 } : m)) } as unknown as HouseholdState;
  const modelPlus = computeRetirementModel({
    state: statePlus, today: "2026-11-08", slipFc, k401Totals: payslip401kTotals(slips, "2026-11-08", state.jobs),
    retBalance: 0, retMonthly: 0, effIncome: slipFc ? slipFc.projectedTaxable : 0, moneyFmt: money,
  });
  eq("G: the second fixture is accuracy X+", modelPlus.accuracy.level, "X+");
  eq("G: at X+ the Home tile keeps the model's range label", modelPlus.homeRangeLabel, modelPlus.directional!.rangeLabel);
  eq("G: at X+ the Home timeline IS the details timeline", modelPlus.homeTimeline === modelPlus.timeline, true);
}

console.log(`round59: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
