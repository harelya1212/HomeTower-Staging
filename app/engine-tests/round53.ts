// Round 53 acceptance: Copilot's focused feedback on round 52's
// DEVICE output. The round-52 engine math stands; this round is
// presentation (the visual X status card + timeline), the X-only
// status softening, accuracy-gated sharpness, the navigation defect
// fix (exactly five tabs, Retirement hosted inside Plan), and
// global provenance (Unknown is never zero). The owner harness runs
// his fixture state through the same model the Home card renders.
// Run: node engine-tests/round53.ts
import { readFileSync } from "node:fs";
import {
  biggestOpportunityLine,
  directionalOutlook,
  docEvidenceStatus,
  faceStatusFor,
  group2EvidenceStatus,
  group2RowProvenance,
  prescriptionLevel,
  recommendedActionText,
  retirementTimelineModel,
  valueStatusBadge,
  type DirectionalInput,
  type RecommendedAction,
  type SsDocLike,
} from "../src/goals.ts";
import { payslip401kTotals, payslipForecast } from "../src/payslips.ts";
import { computeRetirementModel } from "../src/retirementModel.ts";
import type { HouseholdState, UiMember } from "../src/store.tsx";
import type { DocumentRecord } from "../engine/intake.ts";

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
}
function ok(name: string, cond: boolean) {
  if (cond) pass++; else { fail++; console.log(`FAIL ${name}`); }
}
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

// ---- Item 3: the X face status wording -----------------------------
{
  const x = faceStatusFor("X", "off_track", 60);
  eq("X + off_track face label", x.label, "Too early to confirm");
  eq("X + off_track face color is yellow, never red", x.colorKey, "yellow");
  eq("X + off_track support sentence", x.support, "Preliminary models do not yet support age 60, but key retirement inputs are still missing.");
  const xp = faceStatusFor("X+", "off_track", 60);
  eq("X+ + off_track shows the computed label", xp.label, "Current path misses target");
  eq("X+ + off_track color is red", xp.colorKey, "red");
  eq("X+ support sentence is null", xp.support, null);
  eq("X++ + off_track shows the computed label", faceStatusFor("X++", "off_track", 60).label, "Current path misses target");
  eq("X + close shows as computed", faceStatusFor("X", "close", 60).label, "Close to target");
  eq("X + close color", faceStatusFor("X", "close", 60).colorKey, "yellow");
  eq("X + on_track shows as computed", faceStatusFor("X", "on_track", 60).label, "On track");
  eq("X + on_track color", faceStatusFor("X", "on_track", 60).colorKey, "green");
  eq("X + needs_improvement shows as computed", faceStatusFor("X", "needs_improvement", 60).label, "Needs improvement");
}

// ---- Item 1: the opportunity line, from the missing list -----------
{
  eq(
    "opportunity: his case (spending + Social Security)",
    biggestOpportunityLine(["a retirement spending target of your own", "a Social Security estimate for each adult", "pension or other dependable retirement income"]),
    "Biggest opportunity: personalize spending + Social Security. Current estimate is based on incomplete data.",
  );
  eq(
    "opportunity: one missing input",
    biggestOpportunityLine(["a Social Security estimate for each adult"]),
    "Biggest opportunity: personalize Social Security. Current estimate is based on incomplete data.",
  );
  eq("opportunity: nothing missing", biggestOpportunityLine([]), null);
}

// ---- Item 4: accuracy controls sharpness ---------------------------
{
  eq("prescription level at X", prescriptionLevel("X"), "none");
  eq("prescription level at X+", prescriptionLevel("X+"), "savings");
  eq("prescription level at X++", prescriptionLevel("X++"), "full");
  // The GT9-shaped saving action ($900/mo reaches the desired age).
  const input: DirectionalInput = {
    adults: [{ name: "Solo", currentAge: 50, retireAge: 60, yearsToRetire: 10, startingBalance: 100000, monthly: 1900 }],
    spendingAnnual: 20000, dependableAnnual: 0, withdrawalRate: 0.04, inflationPct: 2.5, monthlyNet: 15000,
  };
  const saveAction = directionalOutlook(input, money).action;
  eq("fixture action is the saving", saveAction.kind, "save");
  eq("no prescription text at X", recommendedActionText(saveAction, "X"), null);
  ok("savings figure allowed at X+", (recommendedActionText(saveAction, "X+") ?? "").includes("$900"));
  ok("savings figure at X++", (recommendedActionText(saveAction, "X++") ?? "").includes("$900"));
  const delay: RecommendedAction = { kind: "delay", text: "Retire about 2 years later, at 67", impactText: "Estimated current path improves." };
  eq("delay prescription hidden at X", recommendedActionText(delay, "X"), null);
  eq("delay prescription stays qualitative at X+ (no text)", recommendedActionText(delay, "X+"), null);
  eq("delay prescription shown at X++", recommendedActionText(delay, "X++"), delay.text);
  const spend: RecommendedAction = { kind: "spend", text: "Reduce retirement spending by about $5,000 per year", impactText: "" };
  eq("spend prescription hidden at X+", recommendedActionText(spend, "X+"), null);
  eq("spend prescription shown at X++", recommendedActionText(spend, "X++"), spend.text);
  const combo: RecommendedAction = { kind: "combo", text: "Save about $500 more per month and retire about 1 year later", impactText: "" };
  eq("combo prescription hidden at X+", recommendedActionText(combo, "X+"), null);
  eq("combo prescription shown at X++", recommendedActionText(combo, "X++"), combo.text);
  const none: RecommendedAction = { kind: "none", text: "No action needed - review once a year", impactText: "" };
  eq("kind none is never a prescription", recommendedActionText(none, "X++"), null);
}

// ---- Item 2: the timeline model ------------------------------------
{
  const tl = retirementTimelineModel({
    adults: [
      { name: "Adam A", currentAge: 45, retireAge: 65 },
      { name: "Beth B", currentAge: 43, retireAge: 60 },
    ],
    referenceIndex: 0,
    reach: { r7: 63, r6: 65, r5: 67 },
    rangeLabel: "63-67",
    ssClaimAges: [67],
    mortgageEndsAge: 65,
    collegeEnds: [{ label: "College ends 2035", age: 54 }],
  })!;
  ok("timeline builds", tl !== null);
  eq("axis floor is youngest age minus 2", tl.minAge, 41);
  eq("axis ceiling is 82 (the 80+ end)", tl.maxAge, 82);
  eq("two adult rows", tl.rows.length, 2);
  eq("reference row flagged", tl.rows[0].isReference, true);
  eq("other row first name", tl.rows[1].firstName, "Beth");
  eq("band spans the reach range", [tl.band.startAge, tl.band.endAge, tl.band.label, tl.band.unreached], [63, 67, "63-67", false]);
  eq("chips only from present data", tl.chips.map((c) => c.label), ["College ends 2035", "Medicare 65", "Mortgage ends 65", "Social Security 67"]);
  eq("ticks every 10 years", tl.ticks, [50, 60, 70, 80]);

  const bare = retirementTimelineModel({
    adults: [{ name: "Solo", currentAge: 50, retireAge: 60 }],
    referenceIndex: 0,
    reach: { r7: null, r6: null, r5: null },
    rangeLabel: "80+",
    ssClaimAges: [],
    mortgageEndsAge: null,
    collegeEnds: [],
  })!;
  eq("no mortgage/college/SS data yields ONLY the Medicare chip", bare.chips.map((c) => c.label), ["Medicare 65"]);
  eq("unreached band runs to the axis end", [bare.band.startAge, bare.band.endAge, bare.band.label, bare.band.unreached], [80, 82, "80+", true]);

  const partial = retirementTimelineModel({
    adults: [{ name: "Solo", currentAge: 50, retireAge: 60 }],
    referenceIndex: 0,
    reach: { r7: 72, r6: 78, r5: null },
    rangeLabel: "72-80+",
    ssClaimAges: [],
    mortgageEndsAge: null,
    collegeEnds: [],
  })!;
  eq("partially unreached band", [partial.band.startAge, partial.band.endAge, partial.band.label, partial.band.unreached], [72, 82, "72-80+", true]);
  eq("no adults, no timeline", retirementTimelineModel({ adults: [], referenceIndex: 0, reach: { r7: null, r6: null, r5: null }, rangeLabel: "80+", ssClaimAges: [], mortgageEndsAge: null, collegeEnds: [] }), null);
}

// ---- Item 6: provenance goes global --------------------------------
{
  eq("payroll taxes: no documents", docEvidenceStatus([], "payroll_taxes"), "unknown");
  const bareSlip: SsDocLike = { docType: "payslip", capturedOn: "2026-11-01", fields: { employee_name: "Earner A", k401_contribution: "500" } };
  eq("payroll taxes: slips without withholding lines", docEvidenceStatus([bareSlip], "payroll_taxes"), "not_detected");
  const taxedSlip: SsDocLike = { docType: "payslip", capturedOn: "2026-11-01", fields: { employee_name: "Earner A", ytd_federal_withheld: "65255.17" } };
  eq("payroll taxes: withholding on a slip", docEvidenceStatus([taxedSlip], "payroll_taxes"), "from_payslip");

  eq("group2 work_commuting: no documents", group2EvidenceStatus([], "work_commuting"), "unknown");
  eq("group2 work_commuting: documents exist", group2EvidenceStatus([bareSlip], "work_commuting"), "not_detected");
  eq("group2 mortgage_ending: documents exist", group2EvidenceStatus([bareSlip], "mortgage_ending"), "not_detected");
  eq("group2 mortgage_ending: no documents", group2EvidenceStatus([], "mortgage_ending"), "unknown");
  eq("group2 college_support: no documents", group2EvidenceStatus([], "college_support"), "unknown");
  eq("group2 payroll_taxes delegates", group2EvidenceStatus([taxedSlip], "payroll_taxes"), "from_payslip");
  eq("group2 k401 from slips", group2EvidenceStatus([bareSlip], "k401"), "from_payslip");
  eq("group2 k401: no documents", group2EvidenceStatus([], "k401"), "unknown");

  eq("row: untouched, no source, no documents", group2RowProvenance({ amount: 0, derivedAnnual: 0, evidence: "unknown" }), { badge: null, stateLabel: "Unknown" });
  eq("row: untouched, documents exist", group2RowProvenance({ amount: 0, derivedAnnual: 0, evidence: "not_detected" }), { badge: null, stateLabel: "Not detected" });
  eq("row: typed value is USER", group2RowProvenance({ amount: 500, derivedAnnual: 0, evidence: "unknown" }), { badge: "USER", stateLabel: null });
  eq("row: document-supplied value is PAYSLIP", group2RowProvenance({ amount: 1200, derivedAnnual: 1200, evidence: "from_payslip" }), { badge: "PAYSLIP", stateLabel: null });
  eq("row: edited away from the document figure is USER", group2RowProvenance({ amount: 900, derivedAnnual: 1200, evidence: "from_payslip" }), { badge: "USER", stateLabel: null });
  eq("row: typed zero against evidence is USER, never Unknown", group2RowProvenance({ amount: 0, derivedAnnual: 1200, evidence: "from_payslip" }), { badge: "USER", stateLabel: null });
  eq("row: detected on a statement, not entered", group2RowProvenance({ amount: 0, derivedAnnual: 0, evidence: "from_statement" }), { badge: "STATEMENT", stateLabel: null });

  eq("badge vocabulary", [
    valueStatusBadge("from_payslip"), valueStatusBadge("from_statement"), valueStatusBadge("user_confirmed"),
    valueStatusBadge("estimated"), valueStatusBadge("not_detected"), valueStatusBadge("unknown"),
  ], ["PAYSLIP", "STATEMENT", "USER", "ESTIMATE", "Not detected", "Unknown"]);
}

// ---- Item 5: the tab bar structure (source-level) ------------------
{
  const appSrc = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  eq("tab navigator registers exactly five tabs", (appSrc.match(/<Tab\.Screen/g) ?? []).length, 5);
  ok("no tabBarButton anywhere (no hidden tab, no empty slot)", !appSrc.includes("tabBarButton"));
  for (const name of ["Home", "Documents", "MyHouse", "Plan", "Intake"]) {
    ok(`tab present: ${name}`, appSrc.includes(`name="${name}"`));
  }
  ok("Lifestyle is a stack screen, not a tab", appSrc.includes('<Stack.Screen name="Lifestyle"'));
  ok("no Retirement route registered anywhere in App", !appSrc.includes('name="Retirement"'));
  const planSrc = readFileSync(new URL("../src/screens/PlanScreen.tsx", import.meta.url), "utf8");
  ok("Plan consumes the one-shot intent", planSrc.includes("consumeRetirementIntent"));
  ok("Plan hosts the Retirement sections as view state", planSrc.includes("RetirementScreen") && planSrc.includes('kind: "retirement"'));
  const homeSrc = readFileSync(new URL("../src/screens/HomeScreen.tsx", import.meta.url), "utf8");
  ok("GT10: Home card sets the intent and navigates to Plan", homeSrc.includes('setRetirementIntent("readiness")') && homeSrc.includes('navigation.navigate("Plan")'));
  ok("Home X face carries no Recommended line", !homeSrc.includes("Recommended: {directional.action.text}"));
  const lifeSrc = readFileSync(new URL("../src/screens/LifestyleScreen.tsx", import.meta.url), "utf8");
  ok("Lifestyle (a stack screen) reaches Documents through the Tabs navigator", lifeSrc.includes('navigate("Tabs", { screen: "Documents" })') && !lifeSrc.includes('navigate("Documents")'));
}

// ---- Owner harness: his fixture state through the new X face -------
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
  const k = payslip401kTotals(documents, today, state.jobs);
  const model = computeRetirementModel({
    state, today, slipFc, k401Totals: k, retBalance: 0, retMonthly: 0,
    effIncome: slipFc ? slipFc.projectedTaxable : 0, moneyFmt: money,
  });
  // Engine figures identical to round 52 - the math stands.
  eq("harness accuracy still X", model.accuracy.level, "X");
  eq("harness placeholder spending unchanged", model.spendingAnnual, 341566);
  eq("harness projected (today's $) unchanged", Math.round(model.projectedToday), 374033);
  eq("harness need unchanged", model.hhRet.needBase, 8539150);
  const d = model.directional!;
  eq("harness desired age", d.desiredAge, 50);
  eq("harness range unchanged", d.rangeLabel, "80+");
  eq("harness engine rating unchanged (details keep it)", d.rating, "off_track");
  // The face exactly as his device renders it.
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
  eq("face status wording", face.status, "Too early to confirm");
  eq("face status color is yellow (no red verdict)", disp.colorKey, "yellow");
  eq("face support sentence", face.support, "Preliminary models do not yet support age 50, but key retirement inputs are still missing.");
  eq("face desired", face.desired, 50);
  eq("face current path", face.currentPath, "80+");
  eq("face opportunity line", face.opportunity, "Biggest opportunity: personalize spending + Social Security. Current estimate is based on incomplete data.");
  eq("face action", face.cta, "Improve estimate");
  ok("face carries NO dollar figure anywhere", !JSON.stringify(face).includes("$"));
  ok("face carries NO prescription at X", recommendedActionText(d.action, "X") === null);
  ok("timeline inputs present", face.timeline);
  const tl = model.timeline!;
  eq("timeline rows: both adults", tl.rows.length, 2);
  eq("timeline reference row is Yamit (earlier retirer)", tl.rows[1].isReference, true);
  eq("timeline band is the unreached 80+", [tl.band.label, tl.band.unreached], ["80+", true]);
  eq("timeline chips: only Medicare (no SS, mortgage or college data)", tl.chips.map((c) => c.label), ["Medicare 65"]);
  // Provenance on his real documents.
  const docsLike = documents as unknown as SsDocLike[];
  eq("his payroll taxes are payslip-sourced", group2EvidenceStatus(docsLike, "payroll_taxes"), "from_payslip");
  eq("his 401(k) row is payslip-sourced", group2EvidenceStatus(docsLike, "k401"), "from_payslip");
  eq("his work & commuting row: Not detected", group2EvidenceStatus(docsLike, "work_commuting"), "not_detected");
  eq("his mortgage-ending row: Not detected", group2EvidenceStatus(docsLike, "mortgage_ending"), "not_detected");
  console.log(`     harness face: "${face.title}" | ${face.status} | ${face.support} | Desired ${face.desired} | Current path ${face.currentPath} | ${face.opportunity} | [${face.cta}]`);
}

const total = pass + fail;
console.log(fail === 0 ? `ROUND53 OK ${pass}/${total}` : `ROUND53 FAILURES ${fail}/${total}`);
if (fail > 0) process.exit(1);
