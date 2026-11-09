// Round 57 acceptance: HSA contribution semantics (workstream 1)
// and the HSA dual-snapshot presentation model (workstream 2),
// plus the reprocess guarantee for parser changes (the amendment:
// an extractor-version trigger on top of the maps trigger, and a
// retained-text bound that can never cut a statement's tail).
//
// The album flag, in one line: the October statement's HSA period
// total is $89.30 for the MONTH, made of two $44.65 deposits.
// Nothing may read that period total as a per-paycheck amount and
// multiply it by a pay frequency (that is the $178.60 error this
// suite pins shut from every direction it could arise).
//
// Fixture part: faithful condensed text (the real lines, in the
// real order). Golden part: the owner's real combined statement
// through the app's own pdf.js extraction, like the rehearsal.
// Run: node engine-tests/round57.ts
// @ts-nocheck - top-level pdf.js interop in a test harness
import { readFileSync } from "node:fs";
import * as pdfjs from "../node_modules/pdfjs-dist/legacy/build/pdf.mjs";
import { itemsToLines } from "../src/pdfLines.ts";
import {
  extractSectionReading, hsaDepositFields, parseHsaDepositDetail,
  segmentStatement, statementPeriodOf,
} from "../src/statementSections.ts";
import {
  boundRawText, EXTRACTOR_VERSION, hsaBalanceSnapshots, hsaResolution,
  monthNameOf, monthYearOf, RAW_TEXT_CAP, reprocessDocuments,
} from "../src/reconcile.ts";
import { payslipDeductionTotals } from "../src/payslips.ts";

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
}
function ok(name, cond) {
  if (cond) pass++; else { fail++; console.log(`FAIL ${name}`); }
}

const members = [
  { id: "assaf", name: "Assaf Harel", role: "self" },
  { id: "shahar", name: "Shahar Harel", role: "child" },
];

// ---------------------------------------------------------------------------
// Faithful condensed text: the real HSA section's own lines, in
// the real order (summary table first, deposit detail near the
// section's end), and a one-account combined statement around it.
// ---------------------------------------------------------------------------
// The heading sits two lines above the Account Value line (that
// is the real span the segmenter cuts), and the period header
// repeats on the section's own detail pages, as the custodian
// prints it - which is what dates the deposits.
const HSA_SECTION_TEXT = [
  "Account # 231-851100",
  "ASSAF HAREL - HEALTH SAVINGS ACCOUNT",
  "Account Holdings",
  "Account Value: $13,808.57",
  "Change in Account Value $306.56",
  "This Period Year-to-Date",
  "Beginning Account Value $13,502.01 $15,051.63",
  "Additions 89.30 3,621.33",
  "Contributions 89.30 3,621.33",
  "Subtractions - -5,309.46",
  "Ending Account Value $13,808.57 $13,808.57",
  "Contributions and Distributions",
  "Reportable dist. - 5,309.46",
  "INVESTMENT REPORT",
  "October 1, 2026 - October 31, 2026",
  "Contributions",
  "Date Reference Description Amount",
  "10/14 Participant Cur Yr $44.65",
  "10/30 Participant Cur Yr 44.65",
  "Total Contributions $89.30",
].join("\n");

const COMBINED_TEXT = [
  "Statement Period: October 1, 2026 - October 31, 2026",
  "SHAHAR HAREL - BENEFICIARY (529)",
  "Account # 618-579535",
  "Account Value: $4,324.04",
  "Contributions $350.00 $3,500.00",
  "Distrib. to Bene/School - 14,733.34",
  "Account # 231-851100",
  HSA_SECTION_TEXT,
].join("\n");

const hsaSection = segmentStatement(HSA_SECTION_TEXT).find((s) => s.kind === "hsa");
ok("fixture: the HSA section segments", !!hsaSection);
const period = statementPeriodOf(HSA_SECTION_TEXT);
eq("fixture: the section carries its own period", [period?.startIso, period?.endIso, period?.months], ["2026-10-01", "2026-10-31", 1]);

// ---------------------------------------------------------------------------
// A - deposit detail and the per-payroll derivation
// ---------------------------------------------------------------------------
const detail = parseHsaDepositDetail(HSA_SECTION_TEXT, 89.3);
eq("A: deposit detail dates and amounts", detail.deposits.map((d) => [d.date, d.amount]),
  [["2026-10-14", 44.65], ["2026-10-30", 44.65]]);
eq("A: deposit detail description", detail.deposits[0]?.description, "Participant Cur Yr");
eq("A: per-payroll derived from the repeated deposit", detail.perPayroll, 44.65);

const reading = extractSectionReading(hsaSection, period).fields;
eq("A: reading ending balance", reading["ending_balance"], 13808.57);
eq("A: reading period total is the MONTH total", reading["contributions_period"], 89.3);
eq("A: reading contributions YTD", reading["contributions_ytd"], 3621.33);
eq("A: reading distributions YTD", reading["distributions_ytd"], 5309.46);
eq("A: reading per-payroll contribution", reading["per_payroll_contribution"], 44.65);
ok("A: an HSA statement reading carries NO monthly_contribution field",
  !("monthly_contribution" in reading));
const extras = hsaDepositFields(hsaSection);
eq("A: deposit detail persists as dates + amounts",
  JSON.parse(extras["deposit_detail"] ?? "[]").map((d) => [d.date, d.amount]),
  [["2026-10-14", 44.65], ["2026-10-30", 44.65]]);

// Irregular detail: per-payroll stays UNKNOWN, never guessed.
const variant = (lines) => {
  const text = HSA_SECTION_TEXT.split("\n").map((l) => lines[l] ?? l).join("\n");
  const sec = segmentStatement(text).find((s) => s.kind === "hsa");
  return { text, sec, fields: extractSectionReading(sec, statementPeriodOf(text)).fields };
};
const unequal = variant({ "10/30 Participant Cur Yr 44.65": "10/30 Participant Cur Yr 50.00", "Total Contributions $89.30": "Total Contributions $94.65", "Contributions 89.30 3,621.33": "Contributions 94.65 3,621.33", "Additions 89.30 3,621.33": "Additions 94.65 3,621.33" });
eq("A irregular (unequal deposits): no per-payroll", parseHsaDepositDetail(unequal.text, 94.65).perPayroll, null);
ok("A irregular (unequal deposits): the field is absent, not zero",
  !("per_payroll_contribution" in unequal.fields));
eq("A irregular (unequal deposits): detail still persists", JSON.parse(hsaDepositFields(unequal.sec)["deposit_detail"] ?? "[]").length, 2);

const single = variant({ "10/30 Participant Cur Yr 44.65": "Total Dividends, Interest & Other Income $243.20", "Total Contributions $89.30": "Total Contributions $44.65", "Contributions 89.30 3,621.33": "Contributions 44.65 3,621.33", "Additions 89.30 3,621.33": "Additions 44.65 3,621.33" });
eq("A irregular (a single deposit): no per-payroll", parseHsaDepositDetail(single.text, 44.65).perPayroll, null);
ok("A irregular (a single deposit): the field is absent", !("per_payroll_contribution" in single.fields));

const partial = variant({ "Total Contributions $89.30": "Total Contributions $120.00", "Contributions 89.30 3,621.33": "Contributions 120.00 3,621.33", "Additions 89.30 3,621.33": "Additions 120.00 3,621.33" });
eq("A irregular (detail does not account for the period total): no per-payroll",
  parseHsaDepositDetail(partial.text, 120).perPayroll, null);
ok("A irregular (partial listing): the field is absent", !("per_payroll_contribution" in partial.fields));

const twoStreams = variant({ "10/30 Participant Cur Yr 44.65": "10/30 Employer Cur Yr 44.65" });
eq("A irregular (two contribution streams): no per-payroll", parseHsaDepositDetail(twoStreams.text, 89.3).perPayroll, null);

const noBlock = HSA_SECTION_TEXT.split("\n").slice(0, 12).join("\n");
eq("A irregular (no deposit block at all): nothing derived", parseHsaDepositDetail(noBlock, 89.3), { deposits: [], perPayroll: null });
const noBlockSec = segmentStatement(noBlock).find((s) => s.kind === "hsa");
eq("A irregular (no deposit block): no extras persisted", hsaDepositFields(noBlockSec), {});

// ---------------------------------------------------------------------------
// B - THE PACE AUDIT. Every path that could turn an HSA figure
// into a monthly pace, pinned on the fixture: the answer is
// 89.30 everywhere a pace exists at all, and 178.60 nowhere.
// ---------------------------------------------------------------------------
const stmtRecord = {
  docType: "hsa_statement", status: "parsed", confidence: 1, capturedOn: "2026-11-09",
  fields: {
    ending_balance: "13808.57", contributions_period: "89.3", contributions_ytd: "3621.33",
    distributions_ytd: "5309.46", per_payroll_contribution: "44.65",
    deposit_detail: extras["deposit_detail"], statement_as_of: "2026-10-31",
  },
  rawText: HSA_SECTION_TEXT, mapsVersion: "1.14", extractorVersion: EXTRACTOR_VERSION,
};
const res = hsaResolution([stmtRecord]);
eq("B: the resolved period figure is the month total", res.fields.contributions_period.value, 89.3);
eq("B: the statement yields NO monthly pace field", res.fields.monthly_contribution.value, null);
eq("B: the resolved per-payroll figure", res.fields.per_payroll_contribution.value, 44.65);
ok("B: no resolved HSA value is the doubled 178.60",
  Object.values(res.fields).every((f) => f.value !== 178.6));

// The payslip side is the only HSA pace in the app, and it is
// per-paycheck semantics by construction: a $44.65 per-paycheck
// contribution on a semimonthly slip is $89.30 a month.
const slip = {
  docType: "payslip", status: "parsed", confidence: 1, capturedOn: "2026-10-31",
  fields: { employee_name: "ASSAF HAREL", pay_period_end: "10/31/2026", hsa_contribution: "44.65", ytd_hsa: "3621.33" },
};
const paceSlipOnly = payslipDeductionTotals([slip], "2026-11-09", []);
eq("B: payslip pace from a $44.65 paycheck figure is $89.30/mo", paceSlipOnly?.hsaMonthlyPace, 89.3);
const paceMixed = payslipDeductionTotals([slip, stmtRecord], "2026-11-09", []);
eq("B: adding the statement record cannot move the payslip pace", paceMixed?.hsaMonthlyPace, 89.3);
eq("B: a statement alone yields no pace at all", payslipDeductionTotals([stmtRecord], "2026-11-09", []), null);

// ---------------------------------------------------------------------------
// C - dual-snapshot presentation model
// ---------------------------------------------------------------------------
const screenshot = {
  docType: "hsa_statement", status: "parsed", confidence: 1, capturedOn: "2026-11-09",
  fields: { ending_balance: "13769.61" },
};
const dual = hsaBalanceSnapshots([stmtRecord, screenshot]);
eq("C: the current balance is the fresher screenshot's", dual.current.value, 13769.61);
eq("C: the current balance's as-of is the screenshot date", dual.current.asOf, "2026-11-09");
eq("C: the statement snapshot keeps its own figure and date",
  dual.statementSnapshot && [dual.statementSnapshot.value, dual.statementSnapshot.asOf], [13808.57, "2026-10-31"]);
eq("C: the model agrees with the plain resolution", hsaResolution([stmtRecord, screenshot]).fields.ending_balance.value, dual.current.value);

const oneSource = hsaBalanceSnapshots([stmtRecord]);
eq("C: one dated source only - no snapshot block", oneSource.statementSnapshot, null);
eq("C: one dated source - current is the statement's", oneSource.current.value, 13808.57);

const septStmt = { ...stmtRecord, capturedOn: "2026-10-03", fields: { ...stmtRecord.fields, ending_balance: "13000", statement_as_of: "2026-09-30" } };
const twoStmts = hsaBalanceSnapshots([septStmt, stmtRecord]);
eq("C: two statements - current is the fresher statement", twoStmts.current.value, 13808.57);
eq("C: two statements - the earlier one is the snapshot",
  twoStmts.statementSnapshot && [twoStmts.statementSnapshot.value, twoStmts.statementSnapshot.asOf], [13000, "2026-09-30"]);

const oldShot = { ...screenshot, capturedOn: "2026-10-15", fields: { ending_balance: "13900" } };
const shotOlder = hsaBalanceSnapshots([oldShot, stmtRecord]);
eq("C: an older screenshot never shadows a fresher statement", shotOlder.current.value, 13808.57);
eq("C: a screenshot is not a statement snapshot", shotOlder.statementSnapshot, null);

eq("C: month names for the labels", [monthNameOf("2026-10-31"), monthYearOf("2026-10-31")], ["October", "October 2026"]);

// ---------------------------------------------------------------------------
// D - THE REPROCESS GUARANTEE (amendment). State as the round-56
// build saved it: maps 1.13, no extractor stamp, no per-payroll
// fact. The round-57 load path (reprocessDocuments, exactly what
// the store runs) must deliver the new facts with no re-upload.
// ---------------------------------------------------------------------------
const round56Fields = { ...Object.fromEntries(Object.entries(reading).map(([k, v]) => [k, String(v)])), statement_as_of: "2026-10-31" };
delete round56Fields["per_payroll_contribution"];
const round56Record = {
  docType: "hsa_statement", status: "parsed", confidence: 1, capturedOn: "2026-11-09",
  fields: round56Fields, rawText: HSA_SECTION_TEXT, mapsVersion: "1.13",
};
ok("D: the round-56 record really has no per-payroll fact", !("per_payroll_contribution" in round56Record.fields));
const rpA = reprocessDocuments([round56Record], members, "1.14");
eq("D: the load path gains the per-payroll fact", rpA.docs[0]?.fields?.["per_payroll_contribution"], "44.65");
eq("D: the period total survives as the month total", rpA.docs[0]?.fields?.["contributions_period"], "89.3");
ok("D: the deposit detail is persisted by the re-read", typeof rpA.docs[0]?.fields?.["deposit_detail"] === "string");
eq("D: the re-read record is stamped current on both versions",
  [rpA.docs[0]?.mapsVersion, rpA.docs[0]?.extractorVersion], ["1.14", EXTRACTOR_VERSION]);
ok("D: the banner names the per-payroll fact as newly read",
  rpA.notes.some((n) => n.includes("per-payroll") && n.includes("44.65")));
const rpA2 = reprocessDocuments(rpA.docs, members, "1.14");
eq("D: the pass is idempotent afterwards", [rpA2.docs.length, rpA2.notes.length], [1, 0]);

// The real span's shape: on the owner's statement the HSA
// section's retained text holds NO Account # line (the number
// sits earlier in the document flow), so the span alone segments
// to nothing. The record must still re-read as its own section.
const spanNoAccount = HSA_SECTION_TEXT.split("\n").slice(1).join("\n");
eq("D: the account-line-less span really segments to nothing", segmentStatement(spanNoAccount).length, 0);
const spanRecord = { ...round56Record, rawText: spanNoAccount };
const rpSpan = reprocessDocuments([spanRecord], members, "1.14");
eq("D: a fanned record re-reads as its own section anyway", rpSpan.docs[0]?.fields?.["per_payroll_contribution"], "44.65");
ok("D: the own-section re-read is bannered", rpSpan.notes.some((n) => n.includes("per-payroll")));

// The parser-only leg: maps already current, extractor behind.
// A future parser change must still reach the record.
const parserOnlyStale = { ...round56Record, mapsVersion: "1.14", extractorVersion: 1 };
const rpB = reprocessDocuments([parserOnlyStale], members, "1.14");
eq("D: an extractor-behind record re-reads even with current maps", rpB.docs[0]?.fields?.["per_payroll_contribution"], "44.65");
ok("D: the parser-only re-read is noted", rpB.notes.length > 0);

// Fully current: untouched, by reference.
const fullyCurrent = { ...round56Record, fields: { ...round56Fields, per_payroll_contribution: "44.65" }, mapsVersion: "1.14", extractorVersion: EXTRACTOR_VERSION };
const rpC = reprocessDocuments([fullyCurrent], members, "1.14");
ok("D: a fully current record is untouched", rpC.docs[0] === fullyCurrent && rpC.notes.length === 0);

// The combined statement saved as ONE record fans out on the same
// pass, and its HSA reading carries the new facts.
const combined56 = {
  docType: "529_statement", status: "parsed", confidence: 1, capturedOn: "2026-11-09",
  fields: { ending_balance: "46959.53" }, rawText: COMBINED_TEXT, mapsVersion: "1.13",
};
const rpD = reprocessDocuments([combined56], members, "1.14");
eq("D: the combined record fans out", rpD.docs.length, 2);
const fannedHsa = rpD.docs.find((d) => d.docType === "hsa_statement");
eq("D: the fanned HSA reading carries the per-payroll fact", fannedHsa?.fields?.["per_payroll_contribution"], "44.65");
ok("D: the fan-out banner names the per-payroll fact", rpD.notes.some((n) => n.includes("per-payroll") && n.includes("44.65")));

// ---------------------------------------------------------------------------
// E - retention: the bound can never cut a statement's tail
// ---------------------------------------------------------------------------
eq("E: the retained-text cap is the raised bound", RAW_TEXT_CAP, 200000);
const longText = "x".repeat(150000);
eq("E: a 150,000-char text is retained whole (the old cap cut at 60,000)", boundRawText(longText).length, 150000);
eq("E: the HSA fixture text is retained whole", boundRawText(HSA_SECTION_TEXT), HSA_SECTION_TEXT);

// ---------------------------------------------------------------------------
// GOLDEN - the owner's real combined statement, the app's own
// pdf.js extraction (same loader as the round-55 rehearsal).
// ---------------------------------------------------------------------------
const data = new Uint8Array(readFileSync("/home/hatch/workspace/user/files/Statement10312026.pdf"));
const pdf = await pdfjs.getDocument({ data }).promise;
const pageTexts = [];
for (let p = 1; p <= pdf.numPages; p++) {
  const page = await pdf.getPage(p);
  const content = await page.getTextContent();
  pageTexts.push(itemsToLines(content.items).join("\n"));
}
const fullText = pageTexts.join("\n");
eq("G: the real statement's full text measures 38,856 chars", fullText.length, 38856);
eq("G: the whole real text is retained under the bound", boundRawText(fullText).length, fullText.length);
ok("G: the HSA deposit detail survives inside the retained text",
  boundRawText(fullText).includes("10/30 Participant Cur Yr"));
const realSections = segmentStatement(fullText);
const realHsa = realSections.find((s) => s.kind === "hsa");
const realPeriod = statementPeriodOf(fullText);
const realDetail = parseHsaDepositDetail(realHsa.text, 89.3);
eq("G: real deposit detail", realDetail.deposits.map((d) => [d.date, d.amount]),
  [["2026-10-14", 44.65], ["2026-10-30", 44.65]]);
eq("G: real per-payroll", realDetail.perPayroll, 44.65);
const realReading = extractSectionReading(realHsa, realPeriod).fields;
eq("G: real reading figures", [
  realReading["ending_balance"], realReading["contributions_period"], realReading["contributions_ytd"],
  realReading["distributions_ytd"], realReading["per_payroll_contribution"],
], [13808.57, 89.3, 3621.33, 5309.46, 44.65]);

// The amendment's pin on the real file itself: the HSA reading as
// the round-56 build saved it (real section text retained, maps
// 1.13, no per-payroll) re-read by the round-57 load path.
const realRound56Fields = { ...Object.fromEntries(Object.entries(realReading).map(([k, v]) => [k, String(v)])), statement_as_of: "2026-10-31" };
delete realRound56Fields["per_payroll_contribution"];
const realRound56 = {
  docType: "hsa_statement", status: "parsed", confidence: 1, capturedOn: "2026-11-09",
  fields: realRound56Fields, rawText: realHsa.text, mapsVersion: "1.13",
};
const rpReal = reprocessDocuments([realRound56], members, "1.14");
eq("G: the REAL saved HSA reading gains per-payroll 44.65 with no re-upload",
  rpReal.docs[0]?.fields?.["per_payroll_contribution"], "44.65");
eq("G: the REAL period total stays 89.30", rpReal.docs[0]?.fields?.["contributions_period"], "89.3");
ok("G: the REAL re-read is bannered with the per-payroll fact",
  rpReal.notes.some((n) => n.includes("per-payroll") && n.includes("44.65")));

console.log(`round57: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
