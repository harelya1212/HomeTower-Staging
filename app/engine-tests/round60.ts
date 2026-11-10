// Round 60 - Copilot's root-cause repair (album 0a44oEAkOy2PdBaZb4mq7HoAg).
// The gap he named: between "document successfully understood" and
// "document became the authoritative fact used by the dashboard."
//  A (P0-A) - statement precedence: an owned 401(k) statement
//      replaces the owned 401(k) balance ALWAYS; the household
//      fallback no longer defeats it (it rides along as a
//      genuinely unmapped residual, reported separately).
//  B (P0-B) - canonical validation before upsert: dedupe prevents
//      duplication, not a wrong fact. An HSA reading whose balance
//      is a known 401(k) balance blocks with NEEDS_REVIEW.
//  C (P1-A) - Arizona honesty: the flat-rate model labels itself.
//  D (P1-B) - the bridge years are computed, not assumed away.
//  E (P1-C) - per-domain accuracy; the global score is a
//      completeness indicator and governs nothing per-module.
//  F (P2)   - RetirementDetails match provenance (label pins here;
//      the component renders the same family as trace E).
//  G (sec.8 tail) - default-cost education figures never drive
//      the Home Next Action or the biggest-opportunity line.
// Run: node engine-tests/round60.ts
import { readFileSync } from "node:fs";
import { classifyDocument } from "../engine/classify.ts";
import { extractFields } from "../engine/extract.ts";
import type { DocumentRecord, HouseholdIntake } from "../engine/intake.ts";
import { nextAction } from "../engine/guidance.ts";
import { computeArizonaTax, stateTaxModelInfo } from "../engine/state.ts";
import {
  accumulatedBridgeDraw, adultStartingBalance, biggestOpportunityLine, bridgeGapAnnual,
  deflateToToday, educationOutlookFor, k401StatementMatchFor, projectToCommonDate,
  statementPeriodLabel,
} from "../src/goals.ts";
import { payslip401kTotals, payslipForecast, type PayslipForecast } from "../src/payslips.ts";
import {
  hsaResolution, NEEDS_REVIEW_BALANCE_MATCH, upsertDocument, validateCanonicalEvidence,
} from "../src/reconcile.ts";
import { computeRetirementModel } from "../src/retirementModel.ts";
import { domainAccuracy, hsaAccuracy } from "../src/domainAccuracy.ts";
import { parseHsaPageFields } from "../src/statementSections.ts";
import { textToRawFields } from "../src/textFields.ts";
import type { HouseholdState, UiMember } from "../src/store.tsx";

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
}
function ok(name: string, cond: boolean) {
  if (cond) pass++; else { fail++; console.log(`FAIL ${name}`); }
}
function near(name: string, got: number, want: number, tol = 0.02) {
  if (Math.abs(got - want) <= tol) pass++; else { fail++; console.log(`FAIL ${name}: got ${got} want ~${want}`); }
}
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const FIX = "/home/hatch/workspace/hometower-staging/app/engine-tests/fixtures";

// ---- Shared fixture state (the round-52 harness state) ------------
const fx = JSON.parse(readFileSync("/home/hatch/workspace/hometower/prepared-payslips.json", "utf8"));
const slipDocs = fx.records as DocumentRecord[];
const TODAY = "2026-11-08";
const member = (id: string, name: string, role: "self" | "spouse", dob: string, retireAge: number): UiMember => ({
  id, name, role, dob, retireAge, retireTarget: 0, ssAnnual: 0, ssClaimAge: 67, retireFlex: "fixed",
  pensionAnnual: 0, eduTarget: 0, studentNow: false, collegeStartYear: 0, yearsLeftInCollege: 0,
  eduBalance: 0, eduMonthly: 0, eduAnnualCost: 0, eduInState: true, eduRoomBoard: true,
  eduScholarshipYear: 0, eduDurationYears: 4,
} as UiMember);
function fixtureState(docs: DocumentRecord[], retireA = 60, retireY = 50): HouseholdState {
  return {
    intake: { name: "Harel", state: "AZ", filingStatus: "married_filing_jointly", members: [], documents: docs },
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
    family: [member("a", "Assaf Harel", "self", "1977-09-26", retireA), member("y", "Yamit Harel", "spouse", "1978-05-15", retireY)],
    jobs: [
      { id: "j1", memberName: "Assaf Harel", employer: "", startDate: "", endDate: "", payFrequency: "semimonthly" },
      { id: "j2", memberName: "Yamit Harel", employer: "", startDate: "", endDate: "", payFrequency: "semimonthly" },
    ],
    assets: [], events: [],
  } as unknown as HouseholdState;
}
const NB_DOC: DocumentRecord = {
  docType: "401k_statement", status: "parsed", confidence: 0.9, capturedOn: "2026-11-09",
  ownerMemberId: "a",
  fields: {
    ending_balance: "271019.12", employer_contribution_period: "11466.08",
    statement_as_of: "2026-11-06", statement_period_start: "2026-01-01", statement_period_end: "2026-11-06",
  },
} as DocumentRecord;

// ---- A (P0-A): statement precedence, function goldens -------------
{
  // Copilot's golden case, verbatim shape: fallback > 0,
  // ownedRows = [], statement401k > 0 -> statement applied, the
  // residual reported separately.
  const g = adultStartingBalance({ owned: [], fallback: 90000, statement401k: 250000 });
  eq("A golden: balance = statement + residual", g.balance, 340000);
  eq("A golden: statement applied", g.statementApplied, true);
  eq("A golden: residual reported separately", g.unmappedFallback, 90000);
  eq("A golden: nothing identified", g.knownOwnedNon401k, 0);
  eq("A golden: statement part", g.statementAmount, 250000);
  // The owner's own figures: the $374,033 fallback was defeating
  // the $271,019.12 statement.
  const own = adultStartingBalance({ owned: [], fallback: 374033, statement401k: 271019.12 });
  near("A owner figures: balance", own.balance, 645052.12);
  eq("A owner figures: applied", own.statementApplied, true);
  near("A owner figures: residual", own.unmappedFallback, 374033);
  // Identified rows present: the statement replaces only the
  // 401(k) sleeve; the fallback plays no part at all.
  const rows = adultStartingBalance({ owned: [{ kind: "401k", value: 180000 }, { kind: "ira", value: 50000 }, { kind: "hsa", value: 20000 }], fallback: 90000, statement401k: 250000 });
  eq("A rows: balance", rows.balance, 320000);
  eq("A rows: replaced own 401k", rows.replaced401k, 180000);
  eq("A rows: identified non-401k", rows.knownOwnedNon401k, 70000);
  eq("A rows: no residual when rows exist", rows.unmappedFallback, 0);
  // No statement: the pre-round-51 composition, unchanged - and
  // the fallback standing alone is honestly an unmapped residual.
  const none = adultStartingBalance({ owned: [], fallback: 90000, statement401k: 0 });
  eq("A no statement: fallback", none.balance, 90000);
  eq("A no statement: not applied", none.statementApplied, false);
  eq("A no statement: fallback is the residual", none.unmappedFallback, 90000);
}

// ---- A2 (P0-A): the device composition through the real model -----
{
  const state = fixtureState([...slipDocs, NB_DOC]);
  const slipFc = payslipForecast(state.intake.documents, state.family, state.jobs, TODAY);
  const k = payslip401kTotals(state.intake.documents, TODAY, state.jobs);
  const model = computeRetirementModel({ state, today: TODAY, slipFc, k401Totals: k, retBalance: 374033, retMonthly: 0, effIncome: slipFc ? slipFc.projectedTaxable : 0, moneyFmt: money });
  const assaf = model.adultOutlook[0];
  near("A2 model: Assaf start = statement + residual", assaf.bal, 645052.12);
  near("A2 model: composition statement part", assaf.startComposition.statementAmount, 271019.12);
  near("A2 model: composition residual part", assaf.startComposition.unmappedFallback, 374033);
  eq("A2 model: composition identified part", assaf.startComposition.knownOwnedNon401k, 0);
  ok("A2 model: the statement became the outlook's 401(k) fact", assaf.stmt401k !== null && Math.abs(assaf.stmt401k.balance - 271019.12) < 0.02);
  near("A2 model: household current balance", model.currentRetBalance, 645052.12);
  // After BOTH round-60 fixes (the bridge draw of section D also
  // lands on this state): projected portfolio in today's dollars.
  eq("A2 model: projected after statement + bridge", Math.round(model.projectedToday), 839595);
}

// ---- B (P0-B): canonical validation --------------------------------
{
  const nbExisting: DocumentRecord[] = [NB_DOC];
  // The real HSA screenshot still saves as HSA $13,769.61.
  const shotText = readFileSync(`${FIX}/round59-hsa-page-ocr.txt`, "utf8");
  const pageFields = parseHsaPageFields(shotText);
  const ex = extractFields(pageFields, "hsa_statement");
  const shotFields: Record<string, string> = Object.fromEntries(Object.entries(ex.fields).map(([k, v]) => [k, String(v)]));
  const shotRec: DocumentRecord = { docType: "hsa_statement", status: "parsed", confidence: 0.9, capturedOn: "2026-11-09", fields: shotFields, rawText: shotText } as DocumentRecord;
  const vShot = validateCanonicalEvidence({ proposedRecord: shotRec, existingDocuments: nbExisting, householdAccounts: [] });
  eq("B screenshot: validation ok", vShot.status, "ok");
  eq("B screenshot: two identity phrases", vShot.hsaPhrases.length, 2);
  eq("B screenshot: balance-local", vShot.balanceLocal, true);
  // The save-path mirror (validate -> upsert): it lands, and the
  // resolved HSA balance is the screenshot's figure.
  const saved = vShot.status === "ok" ? upsertDocument(nbExisting, shotRec) : null;
  ok("B screenshot: saved through the path", saved !== null && saved.docs.length === 2);
  near("B screenshot: resolved balance", hsaResolution(saved!.docs).fields.ending_balance.value ?? 0, 13769.61);

  // A synthetic HSA-framed page carrying the 401(k) figure blocks.
  const fakeText = [
    "Health Savings Account", "HSA Summary", "Balance", "$271,019.12",
    "HSA contributions this year", "Family limit $8,750", "Amount contributed $3,621.33",
    "Employer contribution $0.00", "Qualified medical expenses paid from the account",
  ].join("\n");
  const fakeRec: DocumentRecord = { docType: "hsa_statement", status: "parsed", confidence: 0.9, capturedOn: "2026-11-09", fields: { ending_balance: "271019.12" }, rawText: fakeText } as DocumentRecord;
  const vFake = validateCanonicalEvidence({ proposedRecord: fakeRec, existingDocuments: nbExisting, householdAccounts: [] });
  eq("B synthetic: NEEDS_REVIEW", vFake.status, "needs_review");
  eq("B synthetic: blocking copy is Copilot's", vFake.reasons[0], NEEDS_REVIEW_BALANCE_MATCH);
  near("B synthetic: matched balance named", vFake.matched401kBalance ?? 0, 271019.12);
  const notSaved = vFake.status === "ok" ? upsertDocument(nbExisting, fakeRec) : null;
  eq("B synthetic: never reaches upsert", notSaved, null);
  // The same knowledge held as an asset row blocks identically.
  const vFakeRow = validateCanonicalEvidence({ proposedRecord: fakeRec, existingDocuments: [], householdAccounts: [{ kind: "401k", value: 271019.12 }] });
  eq("B synthetic (asset row): NEEDS_REVIEW", vFakeRow.status, "needs_review");
  // Within $1 counts; $2 away does not.
  const almost: DocumentRecord = { ...fakeRec, fields: { ending_balance: "271018.50" }, rawText: fakeText.replace("271,019.12", "271,018.50") } as DocumentRecord;
  eq("B within $1: blocks", validateCanonicalEvidence({ proposedRecord: almost, existingDocuments: nbExisting, householdAccounts: [] }).status, "needs_review");
  const away: DocumentRecord = { ...fakeRec, fields: { ending_balance: "271021.12" }, rawText: fakeText.replace("271,019.12", "271,021.12") } as DocumentRecord;
  eq("B $2 away: passes", validateCanonicalEvidence({ proposedRecord: away, existingDocuments: nbExisting, householdAccounts: [] }).status, "ok");

  // The NetBenefits statement never classifies as HSA - and if a
  // reading were ever forced through as one, validation blocks it.
  const NB_TEXT = [
    "Intel 401(k) Savings Plan", "Statement Period: 01/01/2026 to 11/06/2026", "Ending Balance $271,019.12",
    "Pretax/Roth YTD Contributions $23,269.74", "ER Match YTD Contributions $11,466.08",
    "Total YTD 415 limit Contrib $41,976.54", "Roth in-Plan Conversion", "Vested Balance $271,019.12",
  ].join("\n");
  const cls = classifyDocument(textToRawFields(NB_TEXT), NB_TEXT);
  ok("B NetBenefits: classifier never says HSA", cls.docType !== "hsa_statement");
  eq("B NetBenefits: classifier says 401k", cls.docType, "401k_statement");
  const nbForced: DocumentRecord = { docType: "hsa_statement", status: "parsed", confidence: 0.9, capturedOn: "2026-11-09", fields: { ending_balance: "271019.12" }, rawText: NB_TEXT } as DocumentRecord;
  const vNb = validateCanonicalEvidence({ proposedRecord: nbForced, existingDocuments: [], householdAccounts: [] });
  eq("B NetBenefits forced as HSA: NEEDS_REVIEW", vNb.status, "needs_review");
  ok("B NetBenefits: retirement identity is the blocker", vNb.retirementTypes.length >= 2);
  ok("B NetBenefits: HSA identity insufficient", vNb.identityCount < 2);

  // A fanned HSA section (the real combined statement's shape:
  // one phrase in text, the rest structural) still saves.
  const secText = "ASSAF HAREL - HEALTH SAVINGS ACCOUNT\nAccount Holdings\nAccount Value: $13,808.57\nContributions 89.30 3,621.33\nDistributions - -5,309.46\n" + "holdings detail ".repeat(50) + "vested shares plan note";
  const secRec: DocumentRecord = { docType: "hsa_statement", status: "parsed", confidence: 0.9, capturedOn: "2026-11-09", accountId: "231-851100", fields: { ending_balance: "13808.57", contributions_ytd: "3621.33", distributions_ytd: "5309.46", per_payroll_contribution: "44.65", statement_as_of: "2026-10-31" }, rawText: secText } as DocumentRecord;
  const vSec = validateCanonicalEvidence({ proposedRecord: secRec, existingDocuments: nbExisting, householdAccounts: [] });
  eq("B combined-statement section: ok", vSec.status, "ok");
  eq("B combined-statement section: structural identity counts", vSec.identityCount, 3);

  // Magnitude alone never blocks.
  const bigRec: DocumentRecord = { docType: "hsa_statement", status: "parsed", confidence: 0.9, capturedOn: "2026-11-09", fields: { ending_balance: "180000" }, rawText: "Health Savings Account\nBalance $180,000.00\nHSA contributions\nFamily limit $8,750\nAmount contributed $8,750.00" } as DocumentRecord;
  eq("B large genuine HSA: ok", validateCanonicalEvidence({ proposedRecord: bigRec, existingDocuments: nbExisting, householdAccounts: [] }).status, "ok");
}

// ---- C (P1-A): Arizona honesty --------------------------------------
{
  const info = stateTaxModelInfo("AZ");
  eq("C AZ: label parts are Copilot's four", info.labelParts, ["Arizona projection", "Planning estimate", "Flat-rate approximation", "Full Arizona return adjustments not yet modeled"]);
  eq("C AZ: full return not modeled", info.fullReturnModeled, false);
  eq("C AZ: model kind", info.modelKind, "flat_rate_approximation");
  eq("C AZ: math unchanged (AGI x 2.5%)", computeArizonaTax(200000), 5000);
  eq("C non-AZ: no flat-model label", stateTaxModelInfo("TX").fullReturnModeled, true);
}

// ---- D (P1-B): the computed bridge ----------------------------------
{
  // The formula, as specified.
  eq("D formula: covered", bridgeGapAnnual({ spendingAnnual: 80000, healthcareAnnual: 6000, taxesAnnual: 4000, debtServiceAnnual: 12000, workingSpouseNetAnnual: 120000, dependableAnnual: 10000 }), 0);
  eq("D formula: gap", bridgeGapAnnual({ spendingAnnual: 80000, healthcareAnnual: 6000, taxesAnnual: 4000, debtServiceAnnual: 12000, workingSpouseNetAnnual: 60000, dependableAnnual: 10000 }), 32000);
  eq("D draw: no years, no draw", accumulatedBridgeDraw(32000, 0, 6), 0);
  near("D draw: accumulated at the return", accumulatedBridgeDraw(32000, 5, 6), 180386.97, 0.5);

  // Same-retirement: no bridge exists.
  const sameState = fixtureState(slipDocs, 60, 59);
  const sameFc = payslipForecast(sameState.intake.documents, sameState.family, sameState.jobs, TODAY);
  const sameK = payslip401kTotals(sameState.intake.documents, TODAY, sameState.jobs);
  const sameModel = computeRetirementModel({ state: sameState, today: TODAY, slipFc: sameFc, k401Totals: sameK, retBalance: 0, retMonthly: 0, effIncome: sameFc ? sameFc.projectedTaxable : 0, moneyFmt: money });
  eq("D same-retirement: bridge is null", sameModel.bridge, null);

  // Staggered-covered: the working spouse's net covers the needs.
  const covState = fixtureState(slipDocs);
  const richFc: PayslipForecast = {
    earners: [{ name: "Assaf Harel", memberId: "a", anchorEnd: "2026-10-31", runRateEnd: "2026-10-31", periodsRemaining: 4, frequency: "semimonthly", frequencyAssumed: false, hasRunRate: true, ytdGross: 400000, ytdTaxable: 380000, ytdFederal: 80000, ytdState: 10000, projectedGross: 520000, projectedTaxable: 500000, projectedFederal: 100000, projectedState: 12000, projectedMedicareWages: 520000, projectedMedicareWithheld: 7540, projectedAddMedWithheld: 0 }],
    projectedGross: 520000, projectedTaxable: 500000, projectedFederal: 100000, projectedState: 12000,
    projectedMedicareWages: 520000, projectedMedicareWithheld: 7540, projectedAddMedWithheld: 0, medicareBasis: "read",
  } as PayslipForecast;
  const covK = payslip401kTotals(covState.intake.documents, TODAY, covState.jobs);
  const covModel = computeRetirementModel({ state: covState, today: TODAY, slipFc: richFc, k401Totals: covK, retBalance: 0, retMonthly: 0, effIncome: richFc.projectedTaxable, moneyFmt: money });
  ok("D covered: bridge exists", covModel.bridge !== null);
  eq("D covered: gap is zero", covModel.bridge!.gapAnnual, 0);
  eq("D covered: flagged covered", covModel.bridge!.covered, true);
  near("D covered: working spouse net", covModel.bridge!.workingSpouseNetAnnual, 408000);
  // And with a zero draw the projection is exactly the no-draw math.
  const aOut = covModel.adultOutlook;
  const yearsOwn = aOut.map((a) => a.years);
  const later = Math.max(...yearsOwn);
  const nominalRef = aOut.reduce((s, a, i) => s + projectToCommonDate(a.bal, a.mo + a.matchMo, yearsOwn[i], later, 6), 0);
  near("D covered: projection is the no-draw projection", covModel.projectedToday, deflateToToday(nominalRef, later, 2.5), 1);

  // Staggered-gap on the owner's real fixture: placeholder
  // spending against Assaf's real projected net.
  const state = fixtureState(slipDocs);
  const slipFc = payslipForecast(state.intake.documents, state.family, state.jobs, TODAY);
  const k = payslip401kTotals(state.intake.documents, TODAY, state.jobs);
  const model = computeRetirementModel({ state, today: TODAY, slipFc, k401Totals: k, retBalance: 0, retMonthly: 0, effIncome: slipFc ? slipFc.projectedTaxable : 0, moneyFmt: money });
  ok("D fixture gap: bridge exists", model.bridge !== null);
  near("D fixture gap: spending (placeholder)", model.bridge!.spendingAnnual, 341566, 1);
  near("D fixture gap: working spouse net", model.bridge!.workingSpouseNetAnnual, 267703.90, 1);
  near("D fixture gap: gap per year", model.bridge!.gapAnnual, 73862.10, 1);
  eq("D fixture gap: bridge years", model.bridge!.bridgeYears, 9);
  eq("D fixture gap: not covered", model.bridge!.covered, false);
  // The draw is real: it meets or exceeds the whole no-draw
  // nominal projection, so the projected portfolio is exhausted.
  const yearsOwn2 = model.adultOutlook.map((a) => a.years);
  const later2 = Math.max(...yearsOwn2);
  const nominalNoDraw = model.adultOutlook.reduce((s, a, i) => s + projectToCommonDate(a.bal, a.mo + a.matchMo, yearsOwn2[i], later2, 6), 0);
  ok("D fixture gap: accumulated draw exhausts the pace-only portfolio", accumulatedBridgeDraw(model.bridge!.gapAnnual, 9, 6) >= nominalNoDraw);
  eq("D fixture gap: projected is zero after the draw", Math.round(model.projectedToday), 0);
}

// ---- E (P1-C): per-domain accuracy -----------------------------------
{
  const mkIntake = (over: Partial<HouseholdIntake>): HouseholdIntake => ({
    name: "Harel", state: "AZ", filingStatus: "married_filing_jointly", members: [], documents: [],
    hasRsu: false, hasEspp: false, hasForeignAccountsOrIncome: false, calibration: null, ...over,
  } as HouseholdIntake);
  const doc = (docType: string): DocumentRecord => ({ docType, status: "parsed", confidence: 0.9, capturedOn: "2026-11-01" } as DocumentRecord);
  const verified = mkIntake({
    documents: [doc("payslip"), doc("prior_return")],
    calibration: { federalFiled: true, stateFiled: true, outcomeVerified: true, actualFederalRefundOwe: 2500, actualStateRefundOwe: 1200 } as HouseholdIntake["calibration"],
  });
  const d1 = domainAccuracy({ intake: verified, retirementLevel: "X", eduChildren: [], hsaReconExplained: null });
  eq("E federal: verified + payslips = X++", d1.federalTax.level, "X++");
  eq("E state: verified evidence but AZ cap = X+", d1.stateTax.level, "X+");
  ok("E state: basis names the cap", d1.stateTax.basis.includes("Capped at X+"));
  eq("E retirement: passes the model's own level through", d1.retirement.level, "X");
  eq("E education: no children = null", d1.education, null);
  eq("E hsa: no statement = X", d1.hsa.level, "X");

  const bare = domainAccuracy({ intake: mkIntake({}), retirementLevel: "X++", eduChildren: [{ onDefaultCost: true }, { onDefaultCost: true }], hsaReconExplained: null });
  eq("E federal: nothing on file = X", bare.federalTax.level, "X");
  eq("E retirement: X++ passes through", bare.retirement.level, "X++");
  eq("E education: all defaults = X", bare.education!.level, "X");
  const mixed = domainAccuracy({ intake: mkIntake({}), retirementLevel: "X", eduChildren: [{ onDefaultCost: true }, { onDefaultCost: false }], hsaReconExplained: null });
  eq("E education: mixed = X+", mixed.education!.level, "X+");
  const real = domainAccuracy({ intake: mkIntake({}), retirementLevel: "X", eduChildren: [{ onDefaultCost: false }], hsaReconExplained: null });
  eq("E education: all real = X++", real.education!.level, "X++");

  eq("E hsa level: statement + explained = X++", hsaAccuracy(true, true).level, "X++");
  eq("E hsa level: statement + unexplained = X+", hsaAccuracy(true, false).level, "X+");
  eq("E hsa level: statement only = X+", hsaAccuracy(true, null).level, "X+");
  eq("E hsa level: nothing = X", hsaAccuracy(false, null).level, "X");
}

// ---- F (P2): match provenance pins ------------------------------------
{
  const m = k401StatementMatchFor([NB_DOC], "a");
  ok("F match: resolved from the statement", m !== null);
  near("F match: confirmed YTD", m!.periodTotal, 11466.08);
  eq("F match: period derived as 10 months (TS rule)", m!.months, 10);
  near("F match: derived pace", m!.monthly ?? 0, 1146.61);
  eq("F match: period label", m!.periodLabel, "Jan-Nov 2026");
  eq("F label: from start/end fields", statementPeriodLabel({ statement_period_start: "2026-01-01", statement_period_end: "2026-11-06" }), "Jan-Nov 2026");
  eq("F label: from a range string", statementPeriodLabel({ statement_period: "07/01/2026 - 09/30/2026" }), "Jul-Sep 2026");
  eq("F label: unstated period = null", statementPeriodLabel({}), null);
}

// ---- G (sec.8 tail): default-cost education figures drive nothing ----
{
  // The Home Next Action's input surface has no education figure
  // in it: a household whose only open item is a default-cost
  // education gap gets the on-track action, word for word.
  const a = nextAction({
    calibrationMissing: false, calibrationStage: "both", verificationDue: false,
    staleDocs: [], agingDocs: [], missingRequestLabel: null,
    federalPosition: "inside", federalDelta: 0, annualPhaseTitle: "Year-end readiness",
    confidenceBand: "High", confidenceScore: 80,
  });
  eq("G next action: on-track wording", a.action, "You're on track - review this month's snapshot");
  ok("G next action: no education figure anywhere", !/529|college|education|gap/i.test(JSON.stringify(a)));
  // The biggest-opportunity line is composed from the RETIREMENT
  // accuracy missing list only.
  const opp = biggestOpportunityLine(["personalized spending", "Social Security"]);
  ok("G opportunity: names retirement personalization only", opp !== null && !/college|education|\$/i.test(opp));
  // The gate the tail relies on: default-cost children are
  // early-estimate in the model (round 59 F) and the education
  // domain level stays X while any child is on defaults.
  const kids = educationOutlookFor([
    { id: "s", name: "Shahar", dob: "2007-06-01", studentNow: true, yearsLeftInCollege: 3, eduBalance: 4324.04, eduMonthly: 350, eduAnnualCost: 0, eduScholarshipYear: 0, eduDurationYears: 4 },
  ] as never, TODAY, 6, 24000);
  eq("G gate: default-cost child is early-estimate", kids[0].status, "early");
  eq("G gate: education domain stays X", domainAccuracy({ intake: { state: "AZ", documents: [], calibration: null } as unknown as HouseholdIntake, retirementLevel: "X", eduChildren: kids.map((e) => ({ onDefaultCost: e.usingDefaultCost })), hsaReconExplained: null }).education!.level, "X");
}

const total = pass + fail;
console.log(fail === 0 ? `ROUND60 OK ${pass}/${total}` : `ROUND60 FAILURES ${fail}/${total}`);
if (fail > 0) process.exit(1);
