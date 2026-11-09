// Round 55 acceptance: Copilot's ingestion doctrine, implemented
// verbatim - fan-out (A), field-level provenance (B), 529 facts +
// reconciliation (C), HSA reconciliation (D), the SA tax forms
// (E), the expanded 401(k) fact set (F) and reprocessing (G).
// Pure-logic suite on faithful text (the golden rehearsal on the
// real files is round55-rehearsal.ts).
// Run: node engine-tests/round55.ts
import { classifyDocument } from "../engine/classify.ts";
import { extractFields } from "../engine/extract.ts";
import type { DocumentRecord } from "../engine/intake.ts";
import { ocrMapsPack } from "../engine/packs.ts";
import { k401StatementFacts } from "../src/goals.ts";
import {
  extractSectionReading, k401DetailFields, parse401kDetail, parseSaForm,
  portfolioTotalOf, segmentStatement, statementPeriodOf,
} from "../src/statementSections.ts";
import {
  eduResolutionFor, hsaReconciliation, hsaResolution, reconciliationTasks,
  reprocessDocuments, resolveFields,
} from "../src/reconcile.ts";
import { textToRawFields } from "../src/textFields.ts";

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
}
function ok(name: string, cond: boolean) {
  if (cond) pass++; else { fail++; console.log(`FAIL ${name}`); }
}

const VERSION = String(ocrMapsPack().version);
eq("field maps are v1.14", VERSION, "1.14");

// ---------------------------------------------------------------------------
// Faithful text, condensed from the owner's real documents (the
// full files are asserted by the rehearsal suite).
// ---------------------------------------------------------------------------
const COMBINED = [
  "Your Portfolio Value: $46,959.53",
  "Ending Portfolio Value $46,959.53",
  "Statement Period: October 1, 2026 - October 31, 2026",
  "SHAHAR HAREL - BENEFICIARY (529)",
  "Account # 618-579535",
  "Account Value:",
  "$4,324.04",
  "Contributions $350.00 $3,500.00",
  "Distrib. to Bene/School - 14,733.34",
  "Ella Harel - BENEFICIARY (529)",
  "Account # 618-579537",
  "Account Value:",
  "$16,819.52",
  "Contributions $200.00 $2,000.00",
  "Anat Harel - BENEFICIARY (529)",
  "Account # 618-579543",
  "Account Value:",
  "$12,007.40",
  "Contributions $150.00 $1,500.00",
  "ASSAF HAREL - HEALTH SAVINGS ACCOUNT",
  "Account # 231-851100",
  "Account Value: $13,808.57",
  "Reportable dist. - 5,309.46",
  "2026 Participant Contributions $89.30 $3,621.33",
].join("\n");

const NETBENEFITS = [
  "Intel 401(k) Savings Plan",
  "Statement Period: 01/01/2026 to 11/06/2026",
  "Ending Balance $271,019.12",
  "Pretax/Roth YTD Contributions $23,269.74",
  "After-Tax YTD Contributions $7,240.72",
  "ER Match YTD Contributions $11,466.08",
  "Total YTD 415 limit Contrib $41,976.54",
  "Your Contributions $30,510.46",
  "Your Contribution Summary",
  "Pre-Tax Deferred $23,269.74 100% $153,753.86 $153,753.86",
  "401(k) Match $11,466.08 100% $81,427.87 $81,427.87",
  "After Tax Post",
  "$7,240.72 100% $0.00 $0.00",
  "2019",
  "Roth in-Plan",
  "$0.00 100% $35,837.39 $35,837.39",
  "Conversion",
  "Your Account Activity by Fund",
  "TARGET DATE 2045 BTC S&P 500 INDEX",
  "Ending Balance $226,414.39 $44,604.73 $271,019.12",
  "Your Current Investment Elections",
  "BTC S&P 500 INDEX 100%",
  "Total 100%",
].join("\n");

const FORM_5498 = [
  "2025 Form 5498-SA",
  "ASSAF HAREL",
  "123 Main St",
  "Account number 231-851100",
  "2 Total HSA Contributions.......... $8,544.00",
  "3 Total Contributions Made in 2026 for 2025.......... $0.00",
  "4 Rollover Contributions.......... $0.00",
  "5 Fair Market Value of HSA.......... $15,051.63",
  "6 HSA.......... HSA",
  "05/10/26 eDelivered",
].join("\n");
const FORM_1099 = [
  "2025 Distributions from an HSA, Archer MSA, or Medicare Advantage MSA - Form 1099-SA",
  "ASSAF HAREL",
  "123 Main St",
  "Account number 231-851100-001",
  "1 Gross Distribution.......... $7,743.99",
  "2 Earnings on Excess Contributions.......... $0.00",
  "3 Distribution Code.......... 1",
  "4 FMV on Date of Death.......... $0.00",
  "5 HSA.......... HSA",
  "01/11/26 eDelivered",
].join("\n");

// ---------------------------------------------------------------------------
// A - fan-out and the portfolio-total hard rule
// ---------------------------------------------------------------------------
const period = statementPeriodOf(COMBINED);
eq("combined period is one month", period?.months, 1);
eq("combined period end", period?.endIso, "2026-10-31");
eq("portfolio total read as the aggregate", portfolioTotalOf(COMBINED), 46959.53);
const sections = segmentStatement(COMBINED);
eq("fan-out finds four accounts", sections.length, 4);
eq("section kinds", sections.map((s) => s.kind), ["529", "529", "529", "hsa"]);
eq("section accounts", sections.map((s) => s.accountId), ["618-579535", "618-579537", "618-579543", "231-851100"]);
const readings = sections.map((s) => extractSectionReading(s, period));
eq("Shahar balance", readings[0].fields["ending_balance"], 4324.04);
eq("Shahar contributions YTD", readings[0].fields["contributions_ytd"], 3500);
eq("Shahar distributions YTD", readings[0].fields["distributions_ytd"], 14733.34);
eq("Shahar monthly pace (one-month period)", readings[0].fields["monthly_contribution"], 350);
eq("Ella balance", readings[1].fields["ending_balance"], 16819.52);
eq("Ella contributions YTD", readings[1].fields["contributions_ytd"], 2000);
eq("Anat balance", readings[2].fields["ending_balance"], 12007.4);
eq("HSA balance", readings[3].fields["ending_balance"], 13808.57);
eq("HSA distributions YTD", readings[3].fields["distributions_ytd"], 5309.46);
eq("HSA contributions YTD", readings[3].fields["contributions_ytd"], 3621.33);
ok("HARD RULE: the portfolio total is no account's balance",
  readings.every((r) => r.fields["ending_balance"] !== 46959.53));

// ---------------------------------------------------------------------------
// B - field-level provenance: the HSA golden case + conflicts
// ---------------------------------------------------------------------------
const hsaStmt: DocumentRecord = {
  docType: "hsa_statement", status: "parsed", confidence: 1, capturedOn: "2026-11-02",
  fields: { ending_balance: "13808.57", contributions_ytd: "3621.33", distributions_ytd: "5309.46", statement_as_of: "2026-10-31" },
  accountId: "231-851100",
};
const hsaShot: DocumentRecord = {
  docType: "hsa_statement", status: "parsed", confidence: 1, capturedOn: "2026-11-09",
  fields: { ending_balance: "13769.61" },
};
const hsaRes = hsaResolution([hsaStmt, hsaShot]);
eq("B: the November screenshot owns the balance", hsaRes.fields.ending_balance.value, 13769.61);
eq("B: balance source is the screenshot", hsaRes.fields.ending_balance.source === hsaShot, true);
eq("B: October keeps the contributions", hsaRes.fields.contributions_ytd.value, 3621.33);
eq("B: October keeps the distributions", hsaRes.fields.distributions_ytd.value, 5309.46);
eq("B: no conflict in the golden case", hsaRes.conflicts.length, 0);
const hsaStmtTwin: DocumentRecord = { ...hsaStmt, fields: { ...hsaStmt.fields, ending_balance: "13999.99" } };
const conflicted = resolveFields([hsaStmt, hsaStmtTwin]);
eq("B: same field, same date, different value is a conflict", conflicted.conflicts.length, 1);
eq("B: the conflict names the field", conflicted.conflicts[0]?.field, "ending_balance");
eq("B: the conflict carries both values", conflicted.conflicts[0]?.entries.map((e) => e.value), [13808.57, 13999.99]);

// ---------------------------------------------------------------------------
// C - 529 per-child facts + the reconciliation task (wording, dedupe)
// ---------------------------------------------------------------------------
const family = [
  { id: "assaf", name: "Assaf Harel", role: "self" },
  { id: "shahar", name: "Shahar Harel", role: "child" },
  { id: "ella", name: "Ella Harel", role: "child" },
  { id: "anat", name: "Anat Harel", role: "child" },
];
const children = family.filter((m) => m.role === "child");
const doc529 = (childId: string, acct: string, bal: string, ytd: string, dist?: string): DocumentRecord => ({
  docType: "529_statement", status: "parsed", confidence: 1, capturedOn: "2026-11-02",
  fields: { ending_balance: bal, contributions_ytd: ytd, monthly_contribution: "350", statement_as_of: "2026-10-31", ...(dist ? { distributions_ytd: dist } : {}) },
  ownerMemberId: childId, accountId: acct,
});
const docs529 = [
  doc529("shahar", "618-579535", "4324.04", "3500", "14733.34"),
  doc529("ella", "618-579537", "16819.52", "2000"),
  doc529("anat", "618-579543", "12007.40", "1500"),
];
eq("C: Shahar's own balance resolves", eduResolutionFor(docs529, "shahar").fields.ending_balance.value, 4324.04);
eq("C: Ella's balance is independent", eduResolutionFor(docs529, "ella").fields.ending_balance.value, 16819.52);
eq("C: Anat has no distributions", eduResolutionFor(docs529, "anat").fields.distributions_ytd.value, null);
const tasks1 = reconciliationTasks([...docs529, hsaStmt], children, {});
const task529 = tasks1.filter((t) => t.key.startsWith("recon529-"));
eq("C: exactly one 529 task", task529.length, 1);
eq("C: 529 task wording is Copilot's", task529[0]?.title,
  "$14,733 of 2026 529 distributions detected. Qualified education expense evidence needs reconciliation.");
eq("C: 529 task key carries child + year", task529[0]?.key, "recon529-shahar-2026");
// Re-saving the same statement (a fresh reading replacing the old)
// regenerates the identical task set - derivation is the dedupe.
const tasks2 = reconciliationTasks([...docs529, hsaStmt], children, {});
eq("C: regeneration is identical (dedupe by construction)", tasks2.map((t) => t.key), tasks1.map((t) => t.key));
// An unassigned legacy record still reconciles via the printed name.
const legacy529: DocumentRecord = { ...doc529("x", "618-579535", "4324.04", "3500", "14733.34"), ownerMemberId: undefined, fields: { ending_balance: "4324.04", contributions_ytd: "3500", distributions_ytd: "14733.34", statement_as_of: "2026-10-31", beneficiary_name: "SHAHAR HAREL" } };
eq("C: unassigned record matches by printed beneficiary name",
  reconciliationTasks([legacy529], children, {}).filter((t) => t.key === "recon529-shahar-2026").length, 1);

// ---------------------------------------------------------------------------
// D - HSA distribution reconciliation
// ---------------------------------------------------------------------------
const recon2026 = hsaReconciliation([hsaStmt], {});
eq("D: one reconciliation year", recon2026.length, 1);
eq("D: distributions", recon2026[0]?.distributions, 5309.46);
eq("D: receipts matched starts at 0", recon2026[0]?.matched, 0);
eq("D: unverified is the whole figure at first", recon2026[0]?.unverified, 5309.46);
eq("D: source is the statement", recon2026[0]?.source, "statement");
const taskHsa = reconciliationTasks([hsaStmt], children, {}).filter((t) => t.key.startsWith("reconhsa-"));
eq("D: exactly one HSA task", taskHsa.length, 1);
eq("D: HSA task wording", taskHsa[0]?.title, "HSA receipts verification: $5,309.46 distributions detected.");
ok("D: the task detail carries the receipts shape and never implies taxable",
  (taskHsa[0]?.detail.includes("HSA distributions $5,309 / Receipts matched $0 / Still unverified $5,309") ?? false)
  && (taskHsa[0]?.detail.includes("not a tax conclusion") ?? false)
  && !(taskHsa[0]?.detail.toLowerCase().includes("is taxable") ?? true));
const matched = hsaReconciliation([hsaStmt], { "2026": 2000 });
eq("D: matched receipts reduce the unverified side only", matched[0]?.unverified, 3309.46);
eq("D: fully matched closes the task", reconciliationTasks([hsaStmt], children, { "2026": 5309.46 }).filter((t) => t.key.startsWith("reconhsa-")).length, 0);

// ---------------------------------------------------------------------------
// E - the SA tax forms: boxes, years never merged, no balance moves
// ---------------------------------------------------------------------------
const f5498 = parseSaForm(FORM_5498);
eq("E: 5498-SA kind", f5498?.kind, "hsa_5498_sa");
eq("E: 5498-SA tax year", f5498?.taxYear, 2025);
eq("E: 5498-SA account", f5498?.accountId, "231-851100");
eq("E: 5498-SA owner", f5498?.accountOwner, "ASSAF HAREL");
const boxes5498 = extractFields(f5498!.fields, "hsa_5498_sa").fields;
eq("E: 5498 box 2", boxes5498["box_2_contributions"], 8544);
eq("E: 5498 box 5 FMV", boxes5498["box_5_fair_market_value"], 15051.63);
const f1099 = parseSaForm(FORM_1099);
eq("E: 1099-SA kind", f1099?.kind, "hsa_1099_sa");
eq("E: 1099-SA tax year", f1099?.taxYear, 2025);
const boxes1099 = extractFields(f1099!.fields, "hsa_1099_sa").fields;
eq("E: 1099 box 1", boxes1099["box_1_gross_distribution"], 7743.99);
eq("E: 1099 box 3 code", boxes1099["box_3_distribution_code"], 1);
eq("E: 5498 classifies to its own type", classifyDocument([...textToRawFields(FORM_5498), ...f5498!.fields], FORM_5498).docType, "hsa_5498_sa");
eq("E: 1099 classifies to its own type", classifyDocument([...textToRawFields(FORM_1099), ...f1099!.fields], FORM_1099).docType, "hsa_1099_sa");
const sa1099Doc: DocumentRecord = {
  docType: "hsa_1099_sa", status: "parsed", confidence: 1, capturedOn: "2026-11-09",
  fields: { box_1_gross_distribution: "7743.99", tax_year: "2025", account_id: "231-851100-001" },
  formBoxes: { box_1_gross_distribution: "7743.99" },
};
const sa5498Doc: DocumentRecord = {
  docType: "hsa_5498_sa", status: "parsed", confidence: 1, capturedOn: "2026-11-09",
  fields: { box_2_contributions: "8544", box_5_fair_market_value: "15051.63", tax_year: "2025" },
  formBoxes: { box_2_contributions: "8544", box_5_fair_market_value: "15051.63" },
};
const before = JSON.stringify(hsaResolution([hsaStmt, hsaShot]).fields);
const after = JSON.stringify(hsaResolution([hsaStmt, hsaShot, sa1099Doc, sa5498Doc]).fields);
eq("E INVARIANT: saving either form changes no current balance", after, before);
const twoYears = hsaReconciliation([hsaStmt, sa1099Doc], {});
eq("E: the 1099-SA year stays separate from the statement year", twoYears.map((y) => [y.year, y.distributions, y.source]),
  [[2026, 5309.46, "statement"], [2025, 7743.99, "1099-SA"]]);

// ---------------------------------------------------------------------------
// F - the expanded 401(k) fact set
// ---------------------------------------------------------------------------
const detail = parse401kDetail(NETBENEFITS);
eq("F: pretax balance", detail?.pretaxBalance, 153753.86);
eq("F: match balance", detail?.matchBalance, 81427.87);
eq("F: Roth conversion balance", detail?.rothConversionBalance, 35837.39);
ok("F: after-tax balance is a confirmed zero, not missing", detail?.afterTaxBalance === 0);
eq("F: election", detail?.election, "100% BTC S&P 500 INDEX");
eq("F: holdings", detail?.holdings, [{ label: "Target Date 2045", value: 226414.39 }, { label: "BTC S&P 500 Index", value: 44604.73 }]);
const k401raw = extractFields(textToRawFields(NETBENEFITS), "401k_statement").fields;
eq("F: pretax/Roth YTD", k401raw["employee_pretax_roth_ytd"], 23269.74);
eq("F: after-tax YTD", k401raw["after_tax_ytd"], 7240.72);
eq("F: match YTD rides the existing pace field", k401raw["employer_contribution_period"], 11466.08);
const k401Doc: DocumentRecord = {
  docType: "401k_statement", status: "parsed", confidence: 1, capturedOn: "2026-11-09", ownerMemberId: "assaf",
  fields: {
    ...Object.fromEntries(Object.entries(k401raw).map(([k, v]) => [k, String(v)])),
    ...k401DetailFields(detail!),
    statement_as_of: "2026-11-06",
  },
};
const facts = k401StatementFacts([k401Doc], "assaf");
eq("F: facts balance", facts?.balance, 271019.12);
eq("F: facts Mega Backdoor trio", [facts?.afterTaxYtd, facts?.rothConversionBalance, facts?.afterTaxBalance], [7240.72, 35837.39, 0]);
eq("F: facts provenance", facts?.statementAsOf, "2026-11-06");
const k401NoAfterTax: DocumentRecord = { ...k401Doc, fields: { ...k401Doc.fields } };
delete k401NoAfterTax.fields!["after_tax_balance"];
eq("F: an unread after-tax balance is null, never 0", k401StatementFacts([k401NoAfterTax], "assaf")?.afterTaxBalance, null);
eq("F: facts are owner-scoped", k401StatementFacts([k401Doc], "ella"), null);

// ---------------------------------------------------------------------------
// G - reprocessing
// ---------------------------------------------------------------------------
const members = family;
const staleCombined: DocumentRecord = {
  docType: "529_statement", status: "parsed", confidence: 1, capturedOn: "2026-11-02",
  fields: { ending_balance: "46959.53" }, rawText: COMBINED, mapsVersion: "1.12",
};
const rp1 = reprocessDocuments([staleCombined], members, VERSION);
eq("G: a combined record fans out on reprocess", rp1.docs.length, 4);
ok("G: the fan-out is noted", rp1.notes.some((n) => n.includes("split into 4 account readings")));
ok("G: no fanned-out record carries the portfolio total as a balance",
  rp1.docs.every((d) => d.fields?.["ending_balance"] !== "46959.53"));
eq("G: fanned records are stamped current", rp1.docs.every((d) => d.mapsVersion === VERSION), true);
eq("G: the 529 sections are assigned by printed name",
  rp1.docs.filter((d) => d.docType === "529_statement").map((d) => d.ownerMemberId), ["shahar", "ella", "anat"]);
const rp1b = reprocessDocuments(rp1.docs, members, VERSION);
eq("G: reprocessing is idempotent", [rp1b.docs.length, rp1b.notes.length], [4, 0]);
const staleForm: DocumentRecord = {
  docType: "other", status: "parsed", confidence: 1, capturedOn: "2026-11-09",
  fields: {}, rawText: FORM_1099, mapsVersion: "1.12",
};
const rp2 = reprocessDocuments([staleForm], members, VERSION);
eq("G: a form saved as 'other' is re-typed", rp2.docs[0]?.docType, "hsa_1099_sa");
eq("G: its boxes are read on reprocess", rp2.docs[0]?.fields?.["box_1_gross_distribution"], "7743.99");
eq("G: its tax year is recorded", rp2.docs[0]?.fields?.["tax_year"], "2025");
const noText: DocumentRecord = { docType: "payslip", status: "parsed", confidence: 1, capturedOn: "2026-11-01", fields: { gross_pay: "100" }, mapsVersion: "1.12" };
const rp3 = reprocessDocuments([noText], members, VERSION);
eq("G BOUNDARY: a record without retained text is left exactly as it was", rp3.docs[0] === noText && rp3.notes.length === 0, true);
const current: DocumentRecord = { ...hsaStmt, rawText: "anything", mapsVersion: VERSION };
const rp4 = reprocessDocuments([current], members, VERSION);
eq("G: a current-version record is untouched", rp4.docs[0] === current, true);
// Fill-only: a confirmed value is never overwritten by a re-read.
const confirmed401k: DocumentRecord = {
  docType: "401k_statement", status: "parsed", confidence: 1, capturedOn: "2026-11-09", ownerMemberId: "assaf",
  fields: { ending_balance: "999999" }, rawText: NETBENEFITS, mapsVersion: "1.12",
};
const rp5 = reprocessDocuments([confirmed401k], members, VERSION);
eq("G: reprocess fills the new detail facts", rp5.docs[0]?.fields?.["roth_conversion_balance"], "35837.39");
eq("G: reprocess never overwrites a confirmed value", rp5.docs[0]?.fields?.["ending_balance"], "999999");
ok("G: the fill is noted", rp5.notes.length === 1);

console.log(`round55: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
