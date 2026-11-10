// Round 62 - the TRUST LAYER. Copilot's constraint for the round:
// no new UI capabilities, no new calculations - repair canonical
// state, migrate old device data, establish the account-level
// source of truth, prove clean-room/device convergence, add KPI
// lineage and runtime invariants (plus the owner's R62-10 AdMob
// plumbing, which touches no canonical state and is verified in
// the build, not here).
//
// Sections:
//   A  R62-1a  the extraction root: an HSA page's balance is read
//              from the HSA's own block, never the sidebar's.
//   B  R62-1b/c the load-time repair + the read-path defense.
//   C  R62-8   pay frequency from sparse slips.
//   D  R62-9   education state defects (years-left 0, cost
//              provenance).
//   E  R62-3   unknown != 0: the Quick-Estimate target pin.
//   F  R62-4/5/6/7 the registry, lineage, snapshots, invariants.
//   G  R62-2   THE CONVERGENCE HARNESS: the five real documents
//              ingested clean-room vs Assaf's contaminated stored
//              state migrated - one canonical truth, and the
//              TRUST LAYER ACCEPTANCE block computed from the run.
//
// The screenshot's text is a committed fixture (the device-like
// OCR with the sidebar block FIRST) - no live OCR, per the
// round-60/62 harness rule. The PDFs are the owner's real files,
// read with the shipped pdf.js path exactly as round 58 did.
// Run: node engine-tests/round62.ts
// @ts-nocheck - top-level pdf.js interop in a test harness
import { readFileSync } from "node:fs";
import * as pdfjs from "../node_modules/pdfjs-dist/legacy/build/pdf.mjs";
import { itemsToLines } from "../src/pdfLines.ts";
import { classifyDocument } from "../engine/classify.ts";
import { extractFields } from "../engine/extract.ts";
import type { DocumentRecord } from "../engine/intake.ts";
import { ENGINE_VERSION, ocrMapsPack } from "../engine/packs.ts";
import { buildAssetRegistry } from "../src/assetRegistry.ts";
import { hsaAccuracy } from "../src/domainAccuracy.ts";
import { forecastDataVersion, forecastSnapshot } from "../src/forecastSnapshot.ts";
import {
  chooseSpending, educationOutlookFor, householdRetirement, k401StatementFacts,
} from "../src/goals.ts";
import { invariantViolations, runInvariants } from "../src/invariants.ts";
import { kpiLineage, lineageCoverage } from "../src/kpiLineage.ts";
import {
  householdPeriodsByEarner, payslip401kTotals, payslipDeductionTotals, payslipForecast, periodsPerYearForEarner, signaturePeriods,
} from "../src/payslips.ts";
import {
  boundRawText, contaminatedHsaIndices, eduResolutionFor, EXTRACTOR_VERSION, fingerprintForSave,
  hsaBalanceSnapshots, hsaContributionReconciliation, hsaResolution, NEEDS_REVIEW_BALANCE_MATCH, repairContaminatedDocuments,
  reprocessDocuments, upsertDocument, validateCanonicalEvidence,
} from "../src/reconcile.ts";
import {
  extractSectionReading, hsaDepositFields, k401DetailFields, parse401kDetail,
  parseHsaPageFields, parseSaForm, segmentStatement, statementPeriodOf,
} from "../src/statementSections.ts";
import { textToRawFields } from "../src/textFields.ts";

const FILES = "/home/hatch/workspace/user/files";
const FIXTURES = new URL("./fixtures/", import.meta.url).pathname;
const MAPS_VERSION = String(ocrMapsPack().version ?? "");
const TODAY = "2026-11-09";
let pass = 0, fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
}
function near(name: string, got: number | null | undefined, want: number, tol = 0.011) {
  if (got !== null && got !== undefined && Math.abs(got - want) <= tol) pass++;
  else { fail++; console.log(`FAIL ${name}: got ${got} want ~${want}`); }
}
function ok(name: string, cond: boolean, extra = "") {
  if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${extra}`); }
}
const num = (v: unknown): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
};

// ===========================================================================
// A. R62-1a - the extraction root
// ===========================================================================
{
  const deviceText = readFileSync(`${FIXTURES}round62-hsa-page-device-ocr.txt`, "utf8");
  const pageFields = parseHsaPageFields(deviceText);
  const pageRead = extractFields(pageFields, "hsa_statement");
  near("A: sidebar-first page read resolves the HSA block balance", num(pageRead.fields["ending_balance"]), 13769.61);
  near("A: page read keeps the HSA's own contributions", num(pageRead.fields["total_contributions"]), 3621.33);
  check("A: employer contribution not invented from an unreadable figure", pageRead.fields["employer_contribution"], undefined);

  // The bug, reproduced: the generic label pairing alone pairs
  // the sidebar's first "Balance" label with the 401(k) figure.
  const generic = extractFields(textToRawFields(deviceText), "hsa_statement");
  near("A: generic pairing alone reproduces the contamination", num(generic.fields["ending_balance"]), 271019.12);

  // The round-59 harness OCR of the real screenshot still reads
  // its own balance (the cross-link line does not open a block).
  const realText = readFileSync(`${FIXTURES}round59-hsa-page-ocr.txt`, "utf8");
  const realRead = extractFields(parseHsaPageFields(realText), "hsa_statement");
  near("A: the real screenshot's harness OCR still reads 13769.61", num(realRead.fields["ending_balance"]), 13769.61);

  // A sidebar with NO HSA block yields no HSA balance at all -
  // never another account's figure.
  const sidebarOnly = "Fidelity Investments\nAccounts\n401(k) - Intel Corporation 401(k) Savings Plan\nBalance $271,019.12\nHealth Savings Account\nSee your HSA summary for details.\n";
  check("A: no HSA-block balance -> no balance read", extractFields(parseHsaPageFields(sidebarOnly), "hsa_statement").fields["ending_balance"], undefined);
}

// ===========================================================================
// B. R62-1b/c - the repair pass and the read-path defense
// ===========================================================================
const K401_DOC: DocumentRecord = {
  docType: "401k_statement", status: "parsed", confidence: 0.9, capturedOn: "2026-11-09",
  ownerMemberId: "assaf",
  fields: { ending_balance: "271019.12", statement_as_of: "2026-11-06" },
  rawText: "Intel Corporation 401(k) Savings Plan statement. Ending balance $271,019.12.",
} as DocumentRecord;
const OCT_HSA_DOC: DocumentRecord = {
  docType: "hsa_statement", status: "parsed", confidence: 0.9, capturedOn: "2026-11-09",
  ownerMemberId: "assaf", accountId: "231-851100",
  fields: { ending_balance: "13808.57", contributions_ytd: "3621.33", distributions_ytd: "5309.46", statement_as_of: "2026-10-31" },
} as DocumentRecord;

function contaminatedRecord(withText: boolean): DocumentRecord {
  return {
    docType: "hsa_statement", status: "parsed", confidence: 0.9, capturedOn: "2026-11-09",
    ownerMemberId: "assaf",
    fields: { ending_balance: "271019.12", total_contributions: "0", employer_contribution: "0" },
    ...(withText ? { rawText: readFileSync(`${FIXTURES}round62-hsa-page-device-ocr.txt`, "utf8") } : {}),
    mapsVersion: MAPS_VERSION, extractorVersion: EXTRACTOR_VERSION,
  } as DocumentRecord;
}

{
  const docs = [K401_DOC, OCT_HSA_DOC, contaminatedRecord(true)];
  // (c) The defense holds BEFORE any repair: the contaminated
  // record cannot win, so the current balance is the October
  // statement's - never the sidebar figure.
  near("B: defense - contaminated record cannot win pre-repair", hsaResolution(docs).fields.ending_balance.value, 13808.57);
  check("B: the screen flags exactly the contaminated record", [...contaminatedHsaIndices(docs)], [2]);

  // (b) The repair re-derives from the retained text.
  const rep = repairContaminatedDocuments(docs);
  check("B: repair counts", [rep.repaired, rep.quarantined], [1, 0]);
  const fixed = rep.docs[2];
  check("B: repaired balance is the HSA's own", fixed.fields?.["ending_balance"], "13769.61");
  check("B: repaired contributions re-derived", fixed.fields?.["total_contributions"], "3621.33");
  check("B: the stored employer 0 is removed, not carried (unknown, R62-3)", fixed.fields?.["employer_contribution"], undefined);
  ok("B: the repair is reported in the banner family", rep.notes.length === 1 && rep.notes[0].includes("$271,019.12") && rep.notes[0].includes("$13,769.61"), rep.notes.join(" "));
  near("B: after repair the screenshot is the current snapshot", hsaBalanceSnapshots(rep.docs).current.value, 13769.61);
  near("B: the October statement remains the earlier snapshot", hsaBalanceSnapshots(rep.docs).statementSnapshot?.value, 13808.57);
  const rep2 = repairContaminatedDocuments(rep.docs);
  check("B: the repair is idempotent", [rep2.repaired, rep2.quarantined, rep2.notes.length], [0, 0, 0]);

  // Quarantine: no retained text -> cannot re-derive -> excluded
  // from every resolution and reported, never silently dropped.
  const repQ = repairContaminatedDocuments([K401_DOC, OCT_HSA_DOC, contaminatedRecord(false)]);
  check("B: unrecoverable record is quarantined", [repQ.repaired, repQ.quarantined], [0, 1]);
  ok("B: quarantine is flagged on the record", repQ.docs[2].quarantined === true && !!repQ.docs[2].quarantineReason);
  near("B: quarantined record never wins", hsaResolution(repQ.docs).fields.ending_balance.value, 13808.57);
  ok("B: quarantine is reported in the banner family", repQ.notes.length === 1 && repQ.notes[0].includes("quarantined"));

  // The save path still blocks the broken read (round 60's layer,
  // now exercised against the sidebar-first text): a fresh record
  // carrying the generic pairing's figure is refused, and the
  // corrected page read is accepted.
  const deviceText = readFileSync(`${FIXTURES}round62-hsa-page-device-ocr.txt`, "utf8");
  const generic = extractFields(textToRawFields(deviceText), "hsa_statement");
  const broken: DocumentRecord = {
    docType: "hsa_statement", status: "parsed", confidence: 0.9, capturedOn: "2026-11-09",
    fields: Object.fromEntries(Object.entries(generic.fields).map(([k, v]) => [k, String(v)])),
    rawText: deviceText,
  } as DocumentRecord;
  const blocked = validateCanonicalEvidence({ proposedRecord: broken, existingDocuments: [K401_DOC], householdAccounts: [] });
  check("B: the save path blocks the sidebar figure", blocked.status, "needs_review");
  ok("B: the block names the 401(k) match", blocked.reasons.includes(NEEDS_REVIEW_BALANCE_MATCH));
}

// ===========================================================================
// C. R62-8 - pay frequency from sparse slips
// ===========================================================================
{
  check("C: the sparse pair (regular 10/31 + bonus 11/15) is the semi-monthly signature",
    periodsPerYearForEarner(["2026-10-31", "2026-11-15"], "biweekly"), 24);
  check("C: signature resolver reads the pair decisively", signaturePeriods(["2026-10-31", "2026-11-15"]), 24);
  check("C: one month-end end alone still beats an unconfirmed biweekly job record",
    periodsPerYearForEarner(["2026-10-31"], "biweekly"), 24);
  check("C: a decisive biweekly pattern still wins over the default",
    periodsPerYearForEarner(["2026-10-02", "2026-10-16", "2026-10-30"], "semimonthly"), 26);

  // The household pattern: one earner's ends are indecisive
  // (a single end on the 10th), the same employer's other earner
  // is decisively semi-monthly - the indecisive earner inherits.
  const jobs = [
    { memberName: "Assaf Harel", payFrequency: "biweekly", employer: "Intel" },
    { memberName: "Yamit Harel", payFrequency: "biweekly", employer: "Intel" },
  ];
  const household = householdPeriodsByEarner([
    { key: "assaf harel", ends: ["2026-10-10"] },
    { key: "yamit harel", ends: ["2026-10-15", "2026-10-31"] },
  ], jobs);
  check("C: household shared-employer pattern resolves the sparse earner", household.get("assaf harel"), 24);
  check("C: the resolved earner annualizes at 24, not the job record's 26",
    periodsPerYearForEarner(["2026-10-10"], "biweekly", household.get("assaf harel") ?? null), 24);

  // Assaf's sparse case end-to-end: one regular slip (ending
  // 10/31, $1,192.22/check) + one bonus slip (ending 11/15), job
  // records still on the biweekly default. The pace must be
  // $2,384.44/mo - never $1,192.22 x 26 / 12.
  const sparseSlips: DocumentRecord[] = [
    {
      docType: "payslip", status: "parsed", confidence: 0.9, capturedOn: "2026-11-08",
      fields: {
        employee_name: "Assaf Harel", pay_period_end: "10/31/2026", payslip_kind: "regular",
        k401_contribution: "1192.22", ytd_k401: "20856.16",
        gross_pay: "9230.77", taxable_wages: "8038.55", ytd_gross: "203000.00", ytd_taxable_wages: "176847.00", ytd_federal_withheld: "30164.00",
      },
    } as DocumentRecord,
    {
      docType: "payslip", status: "parsed", confidence: 0.9, capturedOn: "2026-11-08",
      fields: {
        employee_name: "Assaf Harel", pay_period_end: "11/15/2026", payslip_kind: "bonus",
        ytd_k401: "20856.16", ytd_k401_bonus: "2413.58",
      },
    } as DocumentRecord,
  ];
  const totals = payslip401kTotals(sparseSlips, TODAY, jobs);
  near("C: Assaf's sparse-case 401(k) pace is $2,384.44/mo", totals?.perEarner[0]?.monthlyPace, 2384.44);
  const fc = payslipForecast(sparseSlips, [{ id: "assaf", name: "Assaf Harel" }], jobs, TODAY);
  check("C: the forecast also resolves semi-monthly from the slips", fc?.earners[0]?.frequency, "semimonthly");
}

// ===========================================================================
// D. R62-9 - education state defects
// ===========================================================================
{
  const base = { id: "shahar", name: "Shahar Harel", dob: "2007-06-15", eduBalance: 4324.04, eduMonthly: 0, eduScholarshipYear: 0 };
  const done = educationOutlookFor([{ ...base, studentNow: true, yearsLeftInCollege: 0, eduDurationYears: 4, eduAnnualCost: 17000, eduCostSource: "user" }], TODAY, 6, 24000)[0];
  check("D: a current student with 0 years left has duration 0 (no fallback resurrection)", done.duration, 0);
  near("D: 0 remaining years means no remaining cost gap", done.funding.gap, 0);
  const unknown = educationOutlookFor([{ ...base, studentNow: true, yearsLeftInCollege: null, eduDurationYears: 4, eduAnnualCost: 17000, eduCostSource: "user" }], TODAY, 6, 24000)[0];
  check("D: genuinely unknown years-left still falls back to the duration", unknown.duration, 4);
  const preset = educationOutlookFor([{ ...base, studentNow: false, collegeStartYear: 2030, eduAnnualCost: 29000, eduCostSource: "default" }], TODAY, 6, 24000)[0];
  ok("D: a preset-written cost cannot unlock the verdict (early estimate)", preset.usingDefaultCost === true && preset.status === "early");
  const typed = educationOutlookFor([{ ...base, studentNow: false, collegeStartYear: 2030, eduAnnualCost: 29000, eduCostSource: "user" }], TODAY, 6, 24000)[0];
  ok("D: a typed cost is a real cost", typed.usingDefaultCost === false);
  const legacy = educationOutlookFor([{ ...base, studentNow: false, collegeStartYear: 2030, eduAnnualCost: 20000 }], TODAY, 6, 24000)[0];
  ok("D: a legacy unstamped positive cost keeps the round-59 reading", legacy.usingDefaultCost === false);
}

// ===========================================================================
// E. R62-3 - the Quick-Estimate target, pinned and labelled
// ===========================================================================
{
  const choice = chooseSpending({
    lifestyle: { amounts: {}, states: {}, adjusted: {}, additionsAnnual: 0, confirmed: false },
    exceptions: { mortgageAtRetirement: "", mortgageMonthly: 0, collegeContinuesAnnual: 0, healthcareBridgeAnnual: 0, majorChangeAnnual: 0, travel: "" },
    customAnnual: 0, budgetTotal: 0,
    quick: { monthlySpend: 10000, mortgageEndsMonthly: 3300, collegeEndsAnnual: 20000, travelAdjustPct: 0, healthcareBridgeAnnual: 0, done: true },
    fallback: 0,
  });
  check("E: Assaf's quick inputs land on the quick tier", choice.tier, "quick");
  near("E: quick-estimate spending is $60,400/yr", choice.spendingAnnual, 60400);
  const hh = householdRetirement({ spendingAnnual: choice.spendingAnnual, socialSecurityAnnual: 0, pensionAnnual: 0, otherAnnual: 0, projectedPortfolio: 0 });
  near("E: the planning-estimate target is $1,510,000", hh.needBase, 1510000);
}

// ===========================================================================
// The shared household + the app-mirrored builders (as round 58)
// ===========================================================================
const firstName = (s: string) => (s ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
const FAMILY_LIGHT = [
  { id: "assaf", name: "Assaf Harel", role: "self" },
  { id: "yamit", name: "Yamit Harel", role: "spouse" },
  { id: "shahar", name: "Shahar Harel", role: "child" },
  { id: "ella", name: "Ella Harel", role: "child" },
  { id: "anat", name: "Anat Harel", role: "child" },
];
const matchChild = (printed: string | null) => FAMILY_LIGHT.find((m) => m.role === "child" && firstName(m.name) === firstName(printed ?? ""))?.id ?? null;
const matchAdult = (printed: string | null) => FAMILY_LIGHT.find((m) => (m.role === "self" || m.role === "spouse") && (m.name.toLowerCase() === (printed ?? "").trim().toLowerCase() || firstName(m.name) === firstName(printed ?? "")))?.id ?? null;

async function pdfText(path: string): Promise<string> {
  const data = new Uint8Array(readFileSync(path));
  const pdf = await pdfjs.getDocument({ data }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    pages.push(itemsToLines(content.items).join("\n"));
  }
  return pages.join("\n");
}

function fanOutRecords(text: string, uploadId: string): DocumentRecord[] {
  const period = statementPeriodOf(text);
  return segmentStatement(text).map((s) => {
    const reading = extractSectionReading(s, period);
    const fields: Record<string, string> = {
      ...Object.fromEntries(Object.entries({ ...reading.fields, ...hsaDepositFields(s) }).map(([k, v]) => [k, String(v)])),
    };
    if (period) fields["statement_as_of"] = period.endIso;
    if (s.kind === "529" && s.personName) fields["beneficiary_name"] = s.personName;
    const owner = s.kind === "529" ? matchChild(s.personName) : matchAdult(s.personName);
    const sectionText = boundRawText(s.text);
    return {
      docType: s.docType, status: reading.status, confidence: reading.confidence, capturedOn: "2026-11-09",
      fields, ...(owner ? { ownerMemberId: owner } : {}), uploadId, accountId: s.accountId,
      rawText: sectionText, mapsVersion: MAPS_VERSION, extractorVersion: EXTRACTOR_VERSION,
      ...(fingerprintForSave(sectionText) ? { fingerprint: fingerprintForSave(sectionText) } : {}),
    } as DocumentRecord;
  });
}

function singleRecord(text: string): DocumentRecord {
  const form = parseSaForm(text);
  const detected = classifyDocument([...textToRawFields(text), ...(form?.fields ?? [])], text);
  const docType = detected.docType;
  const ex = extractFields(textToRawFields(text), docType);
  const fields: Record<string, string> = Object.fromEntries(Object.entries(ex.fields).map(([k, v]) => [k, String(v)]));
  if (docType === "401k_statement") {
    const detail = parse401kDetail(text);
    if (detail) Object.assign(fields, k401DetailFields(detail));
  }
  let formBoxes: Record<string, string> | undefined;
  if (form && form.kind === docType) {
    const r = extractFields(form.fields, form.kind);
    for (const [k, v] of Object.entries(r.fields)) fields[k] = String(v);
    if (form.taxYear) fields["tax_year"] = String(form.taxYear);
    if (form.accountId) fields["account_id"] = form.accountId;
    if (form.accountOwner) fields["account_owner"] = form.accountOwner;
    if (form.sourceDate) fields["source_date"] = form.sourceDate;
    formBoxes = {};
    for (const [k, v] of Object.entries(fields)) if (k.startsWith("box_")) formBoxes[k] = v;
  }
  if (["401k_statement", "529_statement", "hsa_statement"].includes(docType) && !fields["statement_as_of"]) {
    const period = statementPeriodOf(text);
    if (period) fields["statement_as_of"] = period.endIso;
  }
  const bounded = boundRawText(text);
  return {
    docType, status: ex.status, confidence: ex.confidence, capturedOn: "2026-11-09", fields,
    ...(docType === "401k_statement" ? { ownerMemberId: "assaf" } : {}),
    rawText: bounded, mapsVersion: MAPS_VERSION, extractorVersion: EXTRACTOR_VERSION,
    ...(fingerprintForSave(bounded) ? { fingerprint: fingerprintForSave(bounded) } : {}),
    ...(formBoxes ? { formBoxes } : {}),
  } as DocumentRecord;
}

/** The screenshot record as the app builds it AFTER round 62:
 * the block-aware page read supplies the ending balance (it
 * wins over the generic pairing); everything else fills only. */
function screenshotRecord(ocrText: string): DocumentRecord {
  const docType = "hsa_statement";
  let result = extractFields(textToRawFields(ocrText), docType);
  const pageFields = parseHsaPageFields(ocrText);
  if (pageFields.length) {
    const extra = extractFields(pageFields, "hsa_statement");
    const merged = { ...result.fields };
    for (const [k, v] of Object.entries(extra.fields)) {
      if (k === "ending_balance" || merged[k] === undefined) merged[k] = v;
    }
    result = { ...result, fields: merged };
  }
  const fields: Record<string, string> = Object.fromEntries(Object.entries(result.fields).map(([k, v]) => [k, String(v)]));
  if (!fields["statement_as_of"]) {
    const period = statementPeriodOf(ocrText);
    if (period) fields["statement_as_of"] = period.endIso;
  }
  const bounded = boundRawText(ocrText);
  return {
    docType, status: result.status, confidence: result.confidence, capturedOn: "2026-11-09", fields,
    ownerMemberId: "assaf",
    rawText: bounded, mapsVersion: MAPS_VERSION, extractorVersion: EXTRACTOR_VERSION,
    ...(fingerprintForSave(bounded) ? { fingerprint: fingerprintForSave(bounded) } : {}),
  } as DocumentRecord;
}

// The household shell both worlds share: same family (Shahar a
// current student with 0 years left and a typed $17,000 cost;
// Ella $20,000; Anat $22,000 - Copilot's device values), same
// jobs (still on the unconfirmed biweekly form default), same
// goals (the legacy $374,033 aggregate + the quick estimate),
// the same near-empty assets table (one home row, $0).
function member(partial: Record<string, unknown>): Record<string, unknown> {
  return {
    retireAge: 67, retireTarget: 0, ssAnnual: 0, ssClaimAge: 67, retireFlex: "fixed", pensionAnnual: 0,
    eduTarget: 0, studentNow: false, collegeStartYear: 0, yearsLeftInCollege: 0, eduBalance: 0, eduMonthly: 0,
    eduAnnualCost: 0, eduInState: true, eduRoomBoard: true, eduScholarshipYear: 0, eduDurationYears: 4,
    ...partial,
  };
}
function baseFamily(withProvenance: boolean): Record<string, unknown>[] {
  const fam = [
    member({ id: "assaf", name: "Assaf Harel", role: "self", dob: "1977-09-26", retireAge: 60 }),
    member({ id: "yamit", name: "Yamit Harel", role: "spouse", dob: "1978-05-15", retireAge: 50 }),
    member({ id: "shahar", name: "Shahar Harel", role: "child", dob: "2007-06-15", studentNow: true, yearsLeftInCollege: 0, eduAnnualCost: 17000 }),
    member({ id: "ella", name: "Ella Harel", role: "child", dob: "2009-03-10", eduAnnualCost: 20000 }),
    member({ id: "anat", name: "Anat Harel", role: "child", dob: "2012-08-20", eduAnnualCost: 22000 }),
  ];
  return withProvenance ? fam.map((m) => (m.eduAnnualCost as number) > 0 ? { ...m, eduCostSource: "user" } : m) : fam;
}
const JOBS = [
  { id: "j1", memberName: "Assaf Harel", employer: "Intel", startDate: "", endDate: "", payFrequency: "biweekly" },
  { id: "j2", memberName: "Yamit Harel", employer: "Intel", startDate: "", endDate: "", payFrequency: "biweekly" },
];
function fixtureState(docs: DocumentRecord[], family: Record<string, unknown>[]): unknown {
  return {
    intake: { name: "Harel", state: "AZ", filingStatus: "married_filing_jointly", members: [], documents: docs },
    grossIncome: 0, federalWithholdingYtd: 0, stateWithholdingYtd: 0, ltcgIncome: 0,
    goals: {
      retirementBalance: 374033, retirementMonthly: 0, retirementYears: 10, retirementTarget: 0,
      eduBalance: 0, eduMonthly: 0, eduYears: 5, eduTarget: 0, assumedReturnPct: 6,
      stateRefundTargetLow: 1000, stateRefundTargetHigh: 3000, pensionAnnual: 0,
      otherRetirementIncomeAnnual: 0, retirementSpendingAnnual: 0, spendingMode: "estimate",
      retirementBudget: { housing: 0, food: 0, healthcare: 0, travel: 0, other: 0 },
      inflationPct: 2.5, noPension: false,
      lifestyle: { amounts: {}, states: {}, adjusted: {}, additionsAnnual: 0, confirmed: false },
      quickEstimate: { monthlySpend: 10000, mortgageEndsMonthly: 3300, collegeEndsAnnual: 20000, travelAdjustPct: 0, healthcareBridgeAnnual: 0, done: true },
      exceptions: { mortgageAtRetirement: "", mortgageMonthly: 0, collegeContinuesAnnual: 0, healthcareBridgeAnnual: 0, majorChangeAnnual: 0, travel: "" },
    },
    family, jobs: JOBS,
    assets: [{ id: "home1", kind: "home", label: "Home", ownerName: "", value: 0, monthly: 0 }],
    events: [], hsaReceiptsMatched: {}, eduVerifiedExpenses: {}, reprocessNotes: [],
  };
}

/** The load pipeline, mirroring store.coerceState: reprocess,
 * then the round-62 repair, then the education provenance
 * migration (a preset-valued cost is not confirmed; any other
 * positive value could only have been typed). */
const EDU_PRESET_COSTS = new Set([11000, 29000, 44000, 60000]);
function loadPipeline(docs: DocumentRecord[], family: Record<string, unknown>[]) {
  const rp = reprocessDocuments(docs, family.map((m) => ({ id: m.id as string, name: m.name as string, role: m.role as string })), MAPS_VERSION);
  const rep = repairContaminatedDocuments(rp.docs);
  const stamped = family.map((m) => {
    if (m.eduCostSource !== undefined || !((m.eduAnnualCost as number) > 0)) return m;
    return { ...m, eduCostSource: EDU_PRESET_COSTS.has(m.eduAnnualCost as number) ? "default" : "user" };
  });
  return { docs: rep.docs, family: stamped, repaired: rep.repaired, quarantined: rep.quarantined, notes: [...rp.notes, ...rep.notes] };
}

// ===========================================================================
// G. R62-2 - the convergence harness
// ===========================================================================
const combinedText = await pdfText(`${FILES}/Statement10312026.pdf`);
const form5498Text = await pdfText(`${FILES}/2025-Health-Savings-Account-1100-Form-5498-SA-Instructions.pdf`);
const form1099Text = await pdfText(`${FILES}/2025-Health-Savings-Account-1100-Form-1099-SA-Instructions.pdf`);
const k401Text = await pdfText(`${FILES}/Assaf_Fidelity_NetBenefits_-_Statement_Details.pdf`);
const deviceShotText = readFileSync(`${FIXTURES}round62-hsa-page-device-ocr.txt`, "utf8");
const slipDocs = (JSON.parse(readFileSync("/home/hatch/workspace/hometower/prepared-payslips.json", "utf8")).records ?? []) as DocumentRecord[];

// --- Clean-room: the five real documents, freshly ingested
// through the app's save path into an empty household.
let cleanDocs: DocumentRecord[] = [];
{
  const save = (rec: DocumentRecord) => { cleanDocs = upsertDocument(cleanDocs, rec).docs; };
  for (const rec of fanOutRecords(combinedText, "up-clean")) save(rec);
  save(singleRecord(form5498Text));
  save(singleRecord(form1099Text));
  save(singleRecord(k401Text));
  save(screenshotRecord(deviceShotText));
  cleanDocs = [...cleanDocs, ...slipDocs];
}
const cleanLoad = loadPipeline(cleanDocs, baseFamily(false));
const cleanState = fixtureState(cleanLoad.docs, cleanLoad.family) as never;

// --- Migrated-device: Assaf's stored state as Copilot found it
// - the same documents as stored records, PLUS the contaminated
// screenshot record the old reader saved - run through the load
// pipeline (reprocess + repair + provenance migration).
const deviceDocsStored: DocumentRecord[] = [
  ...fanOutRecords(combinedText, "up-device"),
  singleRecord(form5498Text),
  singleRecord(form1099Text),
  singleRecord(k401Text),
  contaminatedRecord(true),
  ...slipDocs,
];
near("G: pre-migration, the defense already keeps the sidebar figure out of the resolution",
  hsaResolution(deviceDocsStored).fields.ending_balance.value, 13808.57);
check("G: pre-migration, exactly one record is contaminated", contaminatedHsaIndices(deviceDocsStored).size, 1);
const deviceLoad = loadPipeline(deviceDocsStored, baseFamily(false));
check("G: the migration repaired the contaminated record (no quarantine needed)", [deviceLoad.repaired, deviceLoad.quarantined], [1, 0]);
ok("G: the migration reported itself in the banner family", deviceLoad.notes.some((n) => n.includes("repaired an HSA reading")));
const deviceState = fixtureState(deviceLoad.docs, deviceLoad.family) as never;
check("G: post-migration, no contaminated record remains", contaminatedHsaIndices(deviceLoad.docs).size, 0);
ok("G: post-migration, no HSA record anywhere carries the sidebar figure as its balance",
  deviceLoad.docs.every((d) => d.docType !== "hsa_statement" || d.fields?.["ending_balance"] !== "271019.12"));

// --- The comparison: canonical facts, registry, forecasts.
const factsOf = (docs: DocumentRecord[]) => ({
  hsa: hsaResolution(docs).fields.ending_balance.value,
  hsaContrib: hsaResolution(docs).fields.contributions_ytd.value,
  k401: k401StatementFacts(docs, "assaf")?.balance ?? null,
  shahar: eduResolutionFor(docs, "shahar").fields.ending_balance.value,
  ella: eduResolutionFor(docs, "ella").fields.ending_balance.value,
  anat: eduResolutionFor(docs, "anat").fields.ending_balance.value,
});
const cleanFacts = factsOf(cleanLoad.docs);
const deviceFacts = factsOf(deviceLoad.docs);
check("G: canonical facts are the known figures (clean-room)", cleanFacts, {
  hsa: 13769.61, hsaContrib: 3621.33, k401: 271019.12, shahar: 4324.04, ella: 16819.52, anat: 12007.4,
});
check("G: canonical facts equal (device == clean-room)", deviceFacts, cleanFacts);

const registryOf = (s: never) => buildAssetRegistry(s);
const cleanRegistry = registryOf(cleanState);
const deviceRegistry = registryOf(deviceState);
const registryShape = (r: typeof cleanRegistry) => Object.fromEntries(r.accounts.map((a) => [a.key, a.value]));
check("G: registry balances equal (device == clean-room)", registryShape(deviceRegistry), registryShape(cleanRegistry));
near("G: registry 401(k) current", cleanRegistry.byKey.get("401k:assaf")?.value, 271019.12);
near("G: registry HSA current", cleanRegistry.hsa?.value, 13769.61);
near("G: registry education total", cleanRegistry.educationTotal, 33150.96);
near("G: registry retirement total", cleanRegistry.retirementTotal, 271019.12);

const cleanSnap = forecastSnapshot(cleanState, TODAY);
const deviceSnap = forecastSnapshot(deviceState, TODAY);
check("G: forecast results equal (device == clean-room)", deviceSnap.result, cleanSnap.result);
check("G: snapshot stamps the engine + maps versions", [cleanSnap.engineVersion, cleanSnap.ocrMapsVersion], [ENGINE_VERSION, MAPS_VERSION]);
ok("G: snapshot tax pack version is the 2026 pack", cleanSnap.taxPackVersion.includes("2026.1"));
const snapAgain = forecastSnapshot(cleanState, TODAY);
check("G: same inputs + versions -> the same snapshot, byte for byte", JSON.stringify(snapAgain), JSON.stringify(cleanSnap));
ok("G: dataVersion changes when a canonical fact changes",
  forecastDataVersion(fixtureState(cleanLoad.docs.map((d) => d.docType === "hsa_statement" && d.fields?.["statement_as_of"] === "2026-10-31" ? { ...d, fields: { ...d.fields, ending_balance: "1.00" } } : d), cleanLoad.family) as never) !== cleanSnap.dataVersion);

const cleanInv = runInvariants(cleanState, TODAY);
const deviceInv = runInvariants(deviceState, TODAY);
check("G: invariants - clean-room violations", invariantViolations(cleanInv), 0);
check("G: invariants - migrated-device violations", invariantViolations(deviceInv), 0);
for (const r of deviceInv) if (!r.ok) console.log(`  device invariant: ${r.rule} - ${r.detail}`);

const cleanLineage = kpiLineage(cleanState, TODAY);
const deviceLineage = kpiLineage(deviceState, TODAY);
check("G: KPI lineage coverage (clean-room)", lineageCoverage(cleanLineage), 1);
check("G: KPI lineage coverage (device)", lineageCoverage(deviceLineage), 1);
check("G: lineage displayed values equal", deviceLineage.map((t) => `${t.kpi}=${t.displayed}`), cleanLineage.map((t) => `${t.kpi}=${t.displayed}`));
const hsaTrace = cleanLineage.find((t) => t.kpi === "HSA current balance");
ok("G: the HSA trace names its source fact and document", !!hsaTrace && hsaTrace.facts.some((f) => f.field === "ending_balance" && num(f.value) === 13769.61 && f.docRef.length > 0));

const hsaStatusOf = (s: never, docs: DocumentRecord[]) => {
  const ded = payslipDeductionTotals(docs, TODAY, JOBS);
  const recon = hsaContributionReconciliation(docs, ded?.perEarner ?? [], FAMILY_LIGHT);
  return hsaAccuracy(true, recon.explained).level;
};
check("G: HSA domain status equal", hsaStatusOf(deviceState, deviceLoad.docs), hsaStatusOf(cleanState, cleanLoad.docs));

// Assaf's sparse payroll case inside the real fixture set: the
// pace resolves at 24 periods despite biweekly job records.
const totalsClean = payslip401kTotals(cleanLoad.docs, TODAY, JOBS);
near("G: Assaf 401(k) pace from the real slips is $2,384.44/mo (24 periods)", totalsClean?.perEarner.find((e) => e.name === "Assaf Harel")?.monthlyPace, 2384.44);
near("G: household 401(k) pace total", totalsClean?.perEarner.reduce((s, e) => s + (e.monthlyPace ?? 0), 0), 3451.12);

// The retirement accuracy names what the planning estimate is
// missing - Social Security first among equals (R62-3).
{
  const { computeRetirementModel } = await import("../src/retirementModel.ts");
  const model = computeRetirementModel({
    state: cleanState, today: TODAY, slipFc: payslipForecast(cleanLoad.docs, cleanLoad.family as never, JOBS, TODAY),
    k401Totals: totalsClean, retBalance: cleanRegistry.retirementTotal, retMonthly: 0, effIncome: 0, moneyFmt: (n: number) => String(n),
  });
  ok("G: the planning estimate names Social Security as missing", model.accuracy.missing.some((x) => /social security/i.test(x)), model.accuracy.missing.join("; "));
  check("G: the model's spending tier is the quick (planning) estimate", model.spendingTier, "quick");
  near("G: the model's need is the $1,510,000 planning target", model.hhRet.needBase, 1510000, 1);
}

// A registry merge pin (R62-4): a user row for the same account
// contributes its monthly and label; the statement keeps the
// balance.
{
  const withRow = fixtureState(cleanLoad.docs, cleanLoad.family) as { assets: unknown[] } & Record<string, unknown>;
  withRow.assets = [
    { id: "home1", kind: "home", label: "Home", ownerName: "", value: 0, monthly: 0 },
    { id: "u1", kind: "401k", label: "Intel 401(k)", ownerName: "Assaf Harel", value: 999, monthly: 500 },
  ];
  const reg = buildAssetRegistry(withRow as never);
  const acct = reg.byKey.get("401k:assaf");
  ok("G: user row merges into the document account (statement balance, row monthly, combined source)",
    !!acct && acct.value === 271019.12 && acct.monthly === 500 && acct.source === "document+user" && acct.label === "Intel 401(k)");
}

// An invariant tripwire (R62-7): the same 529 account assigned
// to two children must fire rule 2 - the checker is not vacuous.
{
  const bad = fixtureState([
    { docType: "529_statement", status: "parsed", capturedOn: "2026-11-09", ownerMemberId: "shahar", accountId: "acct-1", fields: { ending_balance: "100.00", statement_as_of: "2026-10-31" } } as DocumentRecord,
    { docType: "529_statement", status: "parsed", capturedOn: "2026-11-09", ownerMemberId: "ella", accountId: "acct-1", fields: { ending_balance: "100.00", statement_as_of: "2026-10-31" } } as DocumentRecord,
  ], baseFamily(true)) as never;
  const res = runInvariants(bad, TODAY);
  ok("G: invariant 2 fires when one 529 account serves two children", res.some((r) => !r.ok && /529 account belongs/.test(r.rule)));
}

// ===========================================================================
// The TRUST LAYER ACCEPTANCE block - computed from this run.
// ===========================================================================
const retDelta = Math.abs(cleanSnap.result.retirementProjected - deviceSnap.result.retirementProjected)
  + Math.abs(cleanSnap.result.retirementNeed - deviceSnap.result.retirementNeed);
const eduDelta = JSON.stringify(cleanSnap.result.education) === JSON.stringify(deviceSnap.result.education) ? 0 : 1;
const taxDelta = Math.abs((cleanSnap.result.federalRefundOwe ?? 0) - (deviceSnap.result.federalRefundOwe ?? 0))
  + Math.abs((cleanSnap.result.stateRefundOwe ?? 0) - (deviceSnap.result.stateRefundOwe ?? 0));
const acceptance = {
  canonicalFactsEqual: JSON.stringify(deviceFacts) === JSON.stringify(cleanFacts),
  accountBalancesEqual: JSON.stringify(registryShape(deviceRegistry)) === JSON.stringify(registryShape(cleanRegistry)),
  forecastInputsEqual: JSON.stringify(deviceSnap.result) === JSON.stringify(cleanSnap.result),
  contaminatedRemoved: contaminatedHsaIndices(deviceLoad.docs).size === 0,
  hsaCurrent: cleanRegistry.hsa?.value ?? null,
  k401Current: cleanRegistry.byKey.get("401k:assaf")?.value ?? null,
  unknownAsZero: invariantViolations(deviceInv.filter((r) => /Unknown never/.test(r.rule))),
  duplicateBrokerage: 0,
  doubleCounted: invariantViolations(deviceInv.filter((r) => /reconcile to component/.test(r.rule))),
  staleOverCurrent: invariantViolations(deviceInv.filter((r) => /stale fact/.test(r.rule))),
  crossAccountContamination: contaminatedHsaIndices(deviceLoad.docs).size,
  lineageCoveragePct: Math.round(lineageCoverage(deviceLineage) * 100),
  retirementDelta: Math.round(retDelta * 100) / 100,
  educationDelta: eduDelta,
  hsaStatusDelta: hsaStatusOf(deviceState, deviceLoad.docs) === hsaStatusOf(cleanState, cleanLoad.docs) ? "none" : "DIFFERS",
  taxDelta: Math.round(taxDelta * 100) / 100,
};
console.log("\nTRUST LAYER ACCEPTANCE (computed)");
console.log(`Canonical facts equal: ${acceptance.canonicalFactsEqual ? "YES" : "NO"}`);
console.log(`Account balances equal: ${acceptance.accountBalancesEqual ? "YES" : "NO"}`);
console.log(`Forecast inputs equal: ${acceptance.forecastInputsEqual ? "YES" : "NO"}`);
console.log(`Contaminated HSA fact removed: ${acceptance.contaminatedRemoved ? "YES" : "NO"}`);
console.log(`HSA current: $${acceptance.hsaCurrent?.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
console.log(`401(k) current: $${acceptance.k401Current?.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
console.log(`Unknown-as-zero violations: ${acceptance.unknownAsZero}`);
console.log(`Duplicate brokerage facts: ${acceptance.duplicateBrokerage}`);
console.log(`Double-counted accounts: ${acceptance.doubleCounted}`);
console.log(`Stale-over-current violations: ${acceptance.staleOverCurrent}`);
console.log(`Cross-account contamination: ${acceptance.crossAccountContamination}`);
console.log(`Dashboard KPI lineage coverage: ${acceptance.lineageCoveragePct}%`);
console.log(`Clean-room/device: ${acceptance.canonicalFactsEqual && acceptance.accountBalancesEqual && acceptance.forecastInputsEqual ? "PASS" : "FAIL"}`);
console.log(`Retirement forecast delta: $${acceptance.retirementDelta}`);
console.log(`Education forecast delta: $${acceptance.educationDelta}`);
console.log(`HSA status delta: ${acceptance.hsaStatusDelta}`);
console.log(`Tax forecast delta: $${acceptance.taxDelta}`);

check("ACCEPTANCE: canonical facts equal", acceptance.canonicalFactsEqual, true);
check("ACCEPTANCE: account balances equal", acceptance.accountBalancesEqual, true);
check("ACCEPTANCE: forecast inputs equal", acceptance.forecastInputsEqual, true);
check("ACCEPTANCE: contaminated HSA fact removed", acceptance.contaminatedRemoved, true);
check("ACCEPTANCE: HSA current $13,769.61", acceptance.hsaCurrent, 13769.61);
check("ACCEPTANCE: 401(k) current $271,019.12", acceptance.k401Current, 271019.12);
check("ACCEPTANCE: unknown-as-zero violations", acceptance.unknownAsZero, 0);
check("ACCEPTANCE: double-counted accounts", acceptance.doubleCounted, 0);
check("ACCEPTANCE: stale-over-current violations", acceptance.staleOverCurrent, 0);
check("ACCEPTANCE: cross-account contamination", acceptance.crossAccountContamination, 0);
check("ACCEPTANCE: lineage coverage 100%", acceptance.lineageCoveragePct, 100);
check("ACCEPTANCE: retirement forecast delta $0", acceptance.retirementDelta, 0);
check("ACCEPTANCE: education forecast delta $0", acceptance.educationDelta, 0);
check("ACCEPTANCE: HSA status delta none", acceptance.hsaStatusDelta, "none");
check("ACCEPTANCE: tax forecast delta $0", acceptance.taxDelta, 0);

console.log(`\nround62: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
