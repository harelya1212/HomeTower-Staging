// Round 55 GOLDEN REHEARSAL - the owner's five real documents
// through the app's OWN extractors: pdf.js text (the pinned
// pdfjs-dist build + the shipped itemsToLines line builder) for
// the PDFs, and REAL tesseract.js OCR (the app's pinned engine,
// OEM 1, single pass - the web screenshot path takes exactly one
// pass over a wide screenshot) for the HSA screenshot. No
// pdftotext, no hand transcription: if a figure is missed, the
// miss is measured against the raw extracted text here.
// Run: node engine-tests/round55-rehearsal.ts
// (OCR resolves tesseract.js + eng data from HT_OCR_DIR, default
// /tmp/r55/ocr - the app itself loads tesseract from its CDN pin
// at runtime; the rehearsal mirrors the same engine + OEM.)
// @ts-nocheck - top-level pdf.js interop in a test harness
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
// @ts-ignore - the pinned legacy build, same as the rehearsal dumps
import * as pdfjs from "../node_modules/pdfjs-dist/legacy/build/pdf.mjs";
import { itemsToLines } from "../src/pdfLines.ts";
import { columnRawFields } from "../src/pdfColumns.ts";
import { classifyDocument } from "../engine/classify.ts";
import { extractFields } from "../engine/extract.ts";
import type { DocumentRecord } from "../engine/intake.ts";
import { k401StatementFacts, k401StatementMatchFor } from "../src/goals.ts";
import { textToRawFields } from "../src/textFields.ts";
import {
  extractSectionReading, k401DetailFields, parse401kDetail, parseHsaPageFields,
  parseSaForm, portfolioTotalOf, segmentStatement, statementPeriodOf,
} from "../src/statementSections.ts";
import { eduResolutionFor, hsaResolution, reconciliationTasks } from "../src/reconcile.ts";

const FILES = "/home/hatch/workspace/user/files";
let pass = 0, fail = 0;
const rows: string[] = [];
function check(file: string, fact: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  rows.push(`${ok ? "PASS" : "FAIL"}  ${file}  ${fact}: expected ${JSON.stringify(want)} | extracted ${JSON.stringify(got)}`);
}

async function pdfText(path: string): Promise<{ text: string; pages: string[] }> {
  const data = new Uint8Array(readFileSync(path));
  const pdf = await pdfjs.getDocument({ data }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    pages.push(itemsToLines(content.items).join("\n"));
  }
  return { text: pages.join("\n"), pages };
}

const FAMILY = [
  { id: "assaf", name: "Assaf Harel", role: "self" },
  { id: "yamit", name: "Yamit Harel", role: "spouse" },
  { id: "shahar", name: "Shahar Harel", role: "child" },
  { id: "ella", name: "Ella Harel", role: "child" },
  { id: "anat", name: "Anat Harel", role: "child" },
];
const CHILDREN = FAMILY.filter((m) => m.role === "child");
const firstName = (s: string) => (s ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
const matchChild = (printed: string | null) => FAMILY.find((m) => m.role === "child" && firstName(m.name) === firstName(printed ?? ""))?.id ?? null;
const matchAdult = (printed: string | null) => FAMILY.find((m) => (m.role === "self" || m.role === "spouse") && (m.name.toLowerCase() === (printed ?? "").trim().toLowerCase() || firstName(m.name) === firstName(printed ?? "")))?.id ?? null;

// ---------------------------------------------------------------------------
// 1. The combined Fidelity statement - fan-out (workstream A)
// ---------------------------------------------------------------------------
const combined = await pdfText(`${FILES}/Statement10312026.pdf`);
const period = statementPeriodOf(combined.text);
check("combined", "statement period end", period?.endIso, "2026-10-31");
check("combined", "statement period months", period?.months, 1);
check("combined", "portfolio total (aggregate only)", portfolioTotalOf(combined.text), 46959.53);
const sections = segmentStatement(combined.text);
check("combined", "accounts detected", sections.length, 4);
const fanDocs: DocumentRecord[] = sections.map((s) => {
  const reading = extractSectionReading(s, period);
  const fields: Record<string, string> = Object.fromEntries(Object.entries(reading.fields).map(([k, v]) => [k, String(v)]));
  if (period) fields["statement_as_of"] = period.endIso;
  if (s.kind === "529" && s.personName) fields["beneficiary_name"] = s.personName;
  const owner = s.kind === "529" ? matchChild(s.personName) : matchAdult(s.personName);
  return {
    docType: s.docType, status: reading.status, confidence: reading.confidence, capturedOn: "2026-11-09",
    fields, ...(owner ? { ownerMemberId: owner } : {}), uploadId: "up-rehearsal", accountId: s.accountId,
  } as DocumentRecord;
});
const byAcct = (acct: string) => fanDocs.find((d) => d.accountId === acct);
const num = (d: DocumentRecord | undefined, k: string) => (d?.fields?.[k] !== undefined ? Number(d.fields[k]) : null);
check("combined", "Shahar 529 assigned to Shahar", byAcct("618-579535")?.ownerMemberId, "shahar");
check("combined", "Shahar 529 ending balance", num(byAcct("618-579535"), "ending_balance"), 4324.04);
check("combined", "Shahar contributions YTD", num(byAcct("618-579535"), "contributions_ytd"), 3500);
check("combined", "Shahar monthly contribution", num(byAcct("618-579535"), "monthly_contribution"), 350);
check("combined", "Shahar distributions YTD", num(byAcct("618-579535"), "distributions_ytd"), 14733.34);
check("combined", "Ella 529 assigned to Ella", byAcct("618-579537")?.ownerMemberId, "ella");
check("combined", "Ella 529 ending balance", num(byAcct("618-579537"), "ending_balance"), 16819.52);
check("combined", "Ella contributions YTD", num(byAcct("618-579537"), "contributions_ytd"), 2000);
check("combined", "Anat 529 assigned to Anat", byAcct("618-579543")?.ownerMemberId, "anat");
check("combined", "Anat 529 ending balance", num(byAcct("618-579543"), "ending_balance"), 12007.4);
check("combined", "Anat contributions YTD", num(byAcct("618-579543"), "contributions_ytd"), 1500);
const hsaDoc = byAcct("231-851100");
check("combined", "HSA ending balance", num(hsaDoc, "ending_balance"), 13808.57);
check("combined", "HSA contributions YTD", num(hsaDoc, "contributions_ytd"), 3621.33);
check("combined", "HSA distributions YTD (reportable)", num(hsaDoc, "distributions_ytd"), 5309.46);
check("combined", "HARD RULE: $46,959.53 is no account's balance",
  fanDocs.every((d) => num(d, "ending_balance") !== 46959.53), true);
check("combined", "per-child resolution: Shahar", eduResolutionFor(fanDocs, "shahar").fields.ending_balance.value, 4324.04);
check("combined", "per-child resolution: Ella", eduResolutionFor(fanDocs, "ella").fields.ending_balance.value, 16819.52);
check("combined", "per-child resolution: Anat", eduResolutionFor(fanDocs, "anat").fields.ending_balance.value, 12007.4);

// Tasks (workstreams C + D), generated from the saved readings.
const tasks = reconciliationTasks(fanDocs, CHILDREN, {});
const t529 = tasks.filter((t) => t.key === "recon529-shahar-2026");
check("tasks", "one 529 task for Shahar 2026", t529.length, 1);
check("tasks", "529 task wording", t529[0]?.title,
  "$14,733 of 2026 529 distributions detected. Qualified education expense evidence needs reconciliation.");
const tHsa = tasks.filter((t) => t.key === "reconhsa-2026");
check("tasks", "one HSA receipts task for 2026", tHsa.length, 1);
check("tasks", "HSA task wording", tHsa[0]?.title, "HSA receipts verification: $5,309.46 distributions detected.");
// Dedupe: re-saving the same statement (replace, same account +
// period) and regenerating yields the identical task set.
const resaved = fanDocs.map((d) => ({ ...d }));
check("tasks", "dedupe on regenerate", reconciliationTasks(resaved, CHILDREN, {}).map((t) => t.key), tasks.map((t) => t.key));

// ---------------------------------------------------------------------------
// 2. The SA tax forms (workstream E)
// ---------------------------------------------------------------------------
const balancesBefore = JSON.stringify({
  hsa: hsaResolution(fanDocs).fields.ending_balance.value,
  shahar: eduResolutionFor(fanDocs, "shahar").fields.ending_balance.value,
  ella: eduResolutionFor(fanDocs, "ella").fields.ending_balance.value,
  anat: eduResolutionFor(fanDocs, "anat").fields.ending_balance.value,
});
const saDocs: DocumentRecord[] = [];
for (const [file, wantKind] of [
  ["2025-Health-Savings-Account-1100-Form-5498-SA-Instructions.pdf", "hsa_5498_sa"],
  ["2025-Health-Savings-Account-1100-Form-1099-SA-Instructions.pdf", "hsa_1099_sa"],
] as const) {
  const { text } = await pdfText(`${FILES}/${file}`);
  const form = parseSaForm(text);
  const detected = classifyDocument([...textToRawFields(text), ...(form?.fields ?? [])], text);
  check(file.slice(24, 33), "classifies to its own type", detected.docType, wantKind);
  check(file.slice(24, 33), "form identity", form?.kind, wantKind);
  check(file.slice(24, 33), "tax year", form?.taxYear, 2025);
  const r = extractFields(form!.fields, form!.kind);
  const fields: Record<string, string> = Object.fromEntries(Object.entries(r.fields).map(([k, v]) => [k, String(v)]));
  if (form?.taxYear) fields["tax_year"] = String(form.taxYear);
  if (form?.accountId) fields["account_id"] = form.accountId;
  if (form?.accountOwner) fields["account_owner"] = form.accountOwner;
  if (form?.sourceDate) fields["source_date"] = form.sourceDate;
  saDocs.push({ docType: form!.kind, status: r.status, confidence: r.confidence, capturedOn: "2026-11-09", fields } as DocumentRecord);
  if (wantKind === "hsa_5498_sa") {
    check("5498-SA", "box 2 contributions", r.fields["box_2_contributions"], 8544);
    check("5498-SA", "box 3 (made in 2026 for 2025)", r.fields["box_3_contributions_prior_year"], 0);
    check("5498-SA", "box 4 rollover", r.fields["box_4_rollover_contributions"], 0);
    check("5498-SA", "box 5 fair market value", r.fields["box_5_fair_market_value"], 15051.63);
    check("5498-SA", "account", form?.accountId, "231-851100");
    check("5498-SA", "owner", form?.accountOwner, "ASSAF HAREL");
  } else {
    check("1099-SA", "box 1 gross distribution", r.fields["box_1_gross_distribution"], 7743.99);
    check("1099-SA", "box 2 earnings on excess", r.fields["box_2_earnings_on_excess"], 0);
    check("1099-SA", "box 3 distribution code", r.fields["box_3_distribution_code"], 1);
    check("1099-SA", "box 4 FMV on death", r.fields["box_4_fmv_date_of_death"], 0);
    check("1099-SA", "account", form?.accountId, "231-851100-001");
  }
}
const allDocs = [...fanDocs, ...saDocs];
const balancesAfter = JSON.stringify({
  hsa: hsaResolution(allDocs).fields.ending_balance.value,
  shahar: eduResolutionFor(allDocs, "shahar").fields.ending_balance.value,
  ella: eduResolutionFor(allDocs, "ella").fields.ending_balance.value,
  anat: eduResolutionFor(allDocs, "anat").fields.ending_balance.value,
});
check("SA forms", "INVARIANT: every current balance byte-identical after saving both forms", balancesAfter, balancesBefore);
const tasksWithForms = reconciliationTasks(allDocs, CHILDREN, {});
check("SA forms", "the 2025 1099-SA starts its OWN year's task (never merged into 2026)",
  tasksWithForms.filter((t) => t.key === "reconhsa-2025").map((t) => t.title),
  ["HSA receipts verification: $7,743.99 distributions detected."]);
check("SA forms", "the 2026 statement task is unchanged",
  tasksWithForms.filter((t) => t.key === "reconhsa-2026").length, 1);

// ---------------------------------------------------------------------------
// 3. The NetBenefits 401(k) statement (workstream F)
// ---------------------------------------------------------------------------
const nb = await pdfText(`${FILES}/Assaf_Fidelity_NetBenefits_-_Statement_Details.pdf`);
const nbRaw = textToRawFields(nb.text);
check("NetBenefits", "classifies as a 401(k) statement", classifyDocument(nbRaw, nb.text).docType, "401k_statement");
const nbExtract = extractFields(nbRaw, "401k_statement");
const nbDetail = parse401kDetail(nb.text);
const nbPeriod = statementPeriodOf(nb.text);
const nbFields: Record<string, string> = Object.fromEntries(Object.entries(nbExtract.fields).map(([k, v]) => [k, String(v)]));
if (nbDetail) Object.assign(nbFields, k401DetailFields(nbDetail));
if (nbPeriod) nbFields["statement_as_of"] = nbPeriod.endIso;
const nbDoc: DocumentRecord = {
  docType: "401k_statement", status: nbExtract.status, confidence: nbExtract.confidence,
  capturedOn: "2026-11-09", fields: nbFields, ownerMemberId: "assaf",
} as DocumentRecord;
const facts = k401StatementFacts([nbDoc], "assaf");
check("NetBenefits", "ending balance", facts?.balance, 271019.12);
check("NetBenefits", "pretax/Roth contributions YTD", facts?.pretaxRothYtd, 23269.74);
check("NetBenefits", "after-tax contributions YTD (Mega Backdoor in)", facts?.afterTaxYtd, 7240.72);
check("NetBenefits", "employer match YTD", facts?.matchYtd, 11466.08);
check("NetBenefits", "total 415-limit contributions YTD", facts?.total415Ytd, 41976.54);
check("NetBenefits", "your contributions YTD (pretax + after-tax)", facts?.employeeContributionsYtd, 30510.46);
check("NetBenefits", "pretax balance", facts?.pretaxBalance, 153753.86);
check("NetBenefits", "match balance", facts?.matchBalance, 81427.87);
check("NetBenefits", "Roth in-plan conversion balance (Mega Backdoor)", facts?.rothConversionBalance, 35837.39);
check("NetBenefits", "after-tax ending balance is a CONFIRMED zero", facts?.afterTaxBalance, 0);
check("NetBenefits", "future election", facts?.election, "100% BTC S&P 500 INDEX");
check("NetBenefits", "holdings", facts?.holdings, [
  { label: "Target Date 2045", value: 226414.39 },
  { label: "BTC S&P 500 Index", value: 44604.73 },
]);
check("NetBenefits", "provenance: statement period end", facts?.statementAsOf, "2026-11-06");
const nbMatch = k401StatementMatchFor([nbDoc], "assaf");
check("NetBenefits", "Contribution Pace destination: statement match pace (10-month period)",
  nbMatch ? Math.round(nbMatch.monthly * 100) / 100 : null, 1146.61);

// ---------------------------------------------------------------------------
// 4. The HSA screenshot - real tesseract OCR (workstream B)
// ---------------------------------------------------------------------------
const ocrDir = process.env.HT_OCR_DIR ?? "/tmp/r55/ocr";
const ocrRequire = createRequire(`${ocrDir}/package.json`);
const { createWorker } = ocrRequire("tesseract.js");
const worker = await createWorker("eng", 1, { langPath: ocrDir, gzip: true, cachePath: ocrDir, logger: () => {} });
const shotPath = `${FILES}/8B992DC0-B9CF-42C2-BC80-EBE629234C4A-photo-1EFB0E3C-1D99-482C-8974-D29EB2AD826E.jpg`;
const { data } = await worker.recognize(shotPath);
await worker.terminate();
const ocrText: string = data.text;
console.log("--- raw tesseract output (single pass, the app's web path for a wide screenshot) ---");
console.log(ocrText.split("\n").filter((l) => /balance|13,769|contributed|employer/i.test(l)).join("\n"));
console.log("------------------------------------------------------------------------------------");
const shotRaw = textToRawFields(ocrText);
const shotDetected = classifyDocument(shotRaw, ocrText);
let shotResult = extractFields(shotRaw, shotDetected.docType === "hsa_statement" ? "hsa_statement" : shotDetected.docType);
if (shotResult.fields["ending_balance"] === undefined) {
  const pageRaw = parseHsaPageFields(ocrText);
  const extra = extractFields(pageRaw, "hsa_statement");
  const merged = { ...shotResult.fields };
  for (const [k, v] of Object.entries(extra.fields)) if (merged[k] === undefined) merged[k] = v;
  shotResult = { ...shotResult, fields: merged };
}
check("screenshot", "balance figure survives raw OCR verbatim", ocrText.includes("$13,769.61"), true);
check("screenshot", "balance field resolves through the shipped pipeline", shotResult.fields["ending_balance"], 13769.61);
const shotDoc: DocumentRecord = {
  docType: "hsa_statement", status: shotResult.status, confidence: shotResult.confidence,
  capturedOn: "2026-11-09",
  fields: Object.fromEntries(Object.entries(shotResult.fields).map(([k, v]) => [k, String(v)])),
} as DocumentRecord;
const golden = hsaResolution([hsaDoc!, shotDoc]);
check("screenshot", "GOLDEN CASE: the Nov 9 screenshot owns the current balance", golden.fields.ending_balance.value, 13769.61);
check("screenshot", "GOLDEN CASE: balance source is the screenshot", golden.fields.ending_balance.source === shotDoc, true);
check("screenshot", "GOLDEN CASE: October contributions stay statement-sourced", golden.fields.contributions_ytd.value, 3621.33);
check("screenshot", "GOLDEN CASE: October distributions stay statement-sourced", golden.fields.distributions_ytd.value, 5309.46);

console.log(rows.join("\n"));
console.log(`round55-rehearsal: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
