// Round 58 ACCEPTANCE - Copilot's "very important" test on the
// owner's five real files: ingest all five into a fresh state,
// then ingest THE SAME FIVE AGAIN through the app's save path
// (upsertDocument), and prove nothing moved: balances unchanged,
// fact/record count unchanged, task count and amounts unchanged,
// duplicate facts created = 0.
//
// The ingestion mirrors the app's own builders, as the round-55
// rehearsal established them: pdf.js text for the PDFs, real
// tesseract OCR (twice - once per pass, so the screenshot's
// second read is a genuine second OCR, not a cached string) for
// the screenshot; fan-out records exactly as confirmFanOut builds
// them, single records exactly as confirmExtraction builds them,
// every save routed through upsertDocument.
//
// The INGESTION RESULT block at the end is COMPUTED from the
// resulting state, in Copilot's format - not hand-written.
// Run: node engine-tests/round58-harness.ts
// @ts-nocheck - top-level pdf.js / tesseract interop in a test harness
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as pdfjs from "../node_modules/pdfjs-dist/legacy/build/pdf.mjs";
import { itemsToLines } from "../src/pdfLines.ts";
import { classifyDocument } from "../engine/classify.ts";
import { extractFields } from "../engine/extract.ts";
import type { DocumentRecord } from "../engine/intake.ts";
import { ocrMapsPack } from "../engine/packs.ts";
import { k401StatementFacts } from "../src/goals.ts";
import { textToRawFields } from "../src/textFields.ts";
import {
  extractSectionReading, hsaDepositFields, k401DetailFields, parse401kDetail,
  parseHsaPageFields, parseSaForm, segmentStatement, statementPeriodOf,
} from "../src/statementSections.ts";
import {
  boundRawText, eduReconYearsFor, eduResolutionFor, EXTRACTOR_VERSION, fingerprintForSave,
  hsaReconciliation, hsaResolution, reconciliationTasks, upsertDocument,
} from "../src/reconcile.ts";

const FILES = "/home/hatch/workspace/user/files";
const MAPS_VERSION = String(ocrMapsPack().version ?? "");
let pass = 0, fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
}
function ok(name: string, cond: boolean) {
  if (cond) pass++; else { fail++; console.log(`FAIL ${name}`); }
}

const FAMILY = [
  { id: "assaf", name: "Assaf Harel", role: "self" },
  { id: "yamit", name: "Yamit Harel", role: "spouse" },
  { id: "shahar", name: "Shahar Harel", role: "child" },
  { id: "ella", name: "Ella Harel", role: "child" },
  { id: "anat", name: "Anat Harel", role: "child" },
];
const CHILDREN = FAMILY.filter((m) => m.role === "child").map((m) => ({ id: m.id, name: m.name }));
const firstName = (s: string) => (s ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
const matchChild = (printed: string | null) => FAMILY.find((m) => m.role === "child" && firstName(m.name) === firstName(printed ?? ""))?.id ?? null;
const matchAdult = (printed: string | null) => FAMILY.find((m) => (m.role === "self" || m.role === "spouse") && (m.name.toLowerCase() === (printed ?? "").trim().toLowerCase() || firstName(m.name) === firstName(printed ?? "")))?.id ?? null;

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

// ---------------------------------------------------------------------------
// The app's save paths, mirrored (confirmFanOut / confirmExtraction)
// ---------------------------------------------------------------------------
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

function screenshotRecord(ocrText: string): DocumentRecord {
  // The app's read of this page, mirrored: the bare classifier
  // calls the screenshot "other" (the round-55/56 device story),
  // and the record that lands is the HSA reading - the type in
  // force when the upload starts from the HSA card, or the type
  // the user confirms on the card - with the shipped fill-only
  // proximity merge for the balance the generic pairing missed
  // (DocumentsScreen's hsa_statement branch). That is the golden
  // case the round-55 rehearsal pinned.
  const docType = "hsa_statement";
  let result = extractFields(textToRawFields(ocrText), docType);
  if (result.fields["ending_balance"] === undefined) {
    const extra = extractFields(parseHsaPageFields(ocrText), "hsa_statement");
    const merged = { ...result.fields };
    for (const [k, v] of Object.entries(extra.fields)) if (merged[k] === undefined) merged[k] = v;
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
    rawText: bounded, mapsVersion: MAPS_VERSION, extractorVersion: EXTRACTOR_VERSION,
    ...(fingerprintForSave(bounded) ? { fingerprint: fingerprintForSave(bounded) } : {}),
  } as DocumentRecord;
}

// ---------------------------------------------------------------------------
// One ingestion pass over the five files, through upsertDocument
// ---------------------------------------------------------------------------
const ocrDir = process.env.HT_OCR_DIR ?? "/tmp/r55/ocr";
const ocrRequire = createRequire(`${ocrDir}/package.json`);
const { createWorker } = ocrRequire("tesseract.js");
const worker = await createWorker("eng", 1, { langPath: ocrDir, gzip: true, cachePath: ocrDir, logger: () => {} });
const SHOT = `${FILES}/8B992DC0-B9CF-42C2-BC80-EBE629234C4A-photo-1EFB0E3C-1D99-482C-8974-D29EB2AD826E.jpg`;

async function ingestAll(docs: DocumentRecord[], uploadTag: string): Promise<{ docs: DocumentRecord[]; appended: number; refreshed: number }> {
  let appended = 0, refreshed = 0;
  const save = (rec: DocumentRecord) => {
    const r = upsertDocument(docs, rec);
    docs = r.docs;
    if (r.refreshed) refreshed++; else appended++;
  };
  // 1. The combined statement (fan-out save).
  const combined = await pdfText(`${FILES}/Statement10312026.pdf`);
  for (const rec of fanOutRecords(combined, `up-${uploadTag}`)) save(rec);
  // 2 + 3. The two SA tax forms (single saves).
  save(singleRecord(await pdfText(`${FILES}/2025-Health-Savings-Account-1100-Form-5498-SA-Instructions.pdf`)));
  save(singleRecord(await pdfText(`${FILES}/2025-Health-Savings-Account-1100-Form-1099-SA-Instructions.pdf`)));
  // 4. The NetBenefits 401(k) statement (single save).
  save(singleRecord(await pdfText(`${FILES}/Assaf_Fidelity_NetBenefits_-_Statement_Details.pdf`)));
  // 5. The HSA screenshot (a fresh OCR pass every ingestion).
  const { data } = await worker.recognize(SHOT);
  save(screenshotRecord(data.text as string));
  return { docs, appended, refreshed };
}

function snapshot(docs: DocumentRecord[]) {
  const conflicts = hsaResolution(docs).conflicts.length
    + CHILDREN.reduce((n, c) => n + eduResolutionFor(docs, c.id).conflicts.length, 0);
  return {
    records: docs.length,
    facts: docs.reduce((n, d) => n + Object.keys(d.fields ?? {}).length, 0),
    balances: {
      k401: k401StatementFacts(docs, "assaf")?.balance ?? null,
      hsaCurrent: hsaResolution(docs).fields.ending_balance.value,
      shahar529: eduResolutionFor(docs, "shahar").fields.ending_balance.value,
      ella529: eduResolutionFor(docs, "ella").fields.ending_balance.value,
      anat529: eduResolutionFor(docs, "anat").fields.ending_balance.value,
    },
    tasks: reconciliationTasks(docs, CHILDREN, {}, {}).map((t) => `${t.key} :: ${t.title}`),
    conflicts,
  };
}

// ---------------------------------------------------------------------------
// Pass 1 -> snapshot A. Pass 2 (the same five files) -> snapshot B.
// ---------------------------------------------------------------------------
const p1 = await ingestAll([], "pass1");
const A = snapshot(p1.docs);
check("pass 1: every file is new evidence (8 records appended, 0 refreshed)", [p1.appended, p1.refreshed], [8, 0]);
check("pass 1: record count (4 fanned + 2 forms + 401(k) + screenshot)", A.records, 8);
check("pass 1: balances are the known figures", A.balances, {
  k401: 271019.12, hsaCurrent: 13769.61, shahar529: 4324.04, ella529: 16819.52, anat529: 12007.4,
});

const p2 = await ingestAll(p1.docs, "pass2");
const B = snapshot(p2.docs);
await worker.terminate();

check("pass 2: every save refreshed in place (8 refreshed, 0 appended)", [p2.appended, p2.refreshed], [0, 8]);
check("ACCEPTANCE: balances unchanged", B.balances, A.balances);
check("ACCEPTANCE: fact count unchanged", B.facts, A.facts);
check("ACCEPTANCE: record count unchanged", B.records, A.records);
check("ACCEPTANCE: task count and amounts unchanged", B.tasks, A.tasks);
check("ACCEPTANCE: duplicate facts created", B.records - A.records, 0);
check("ACCEPTANCE: register holds one entry per document", [...new Set(p2.docs.map((d) => `${d.docType}|${d.accountId ?? d.fields?.["account_id"] ?? d.ownerMemberId ?? ""}|${d.fields?.["statement_as_of"] ?? d.fields?.["tax_year"] ?? ""}`))].length, 8);

// ---------------------------------------------------------------------------
// The INGESTION RESULT, computed from the final state
// ---------------------------------------------------------------------------
const docs = p2.docs;
const accountIds = new Set<string>();
for (const d of docs) {
  if (d.docType === "401k_statement") accountIds.add("401k");
  else if (d.docType === "529_statement") accountIds.add(`529:${d.accountId ?? ""}`);
  else if (d.docType === "hsa_statement") accountIds.add("hsa");
}
const hsaYears = hsaReconciliation(docs, {});
const hsa2026 = hsaYears.find((y) => y.year === 2026);
const hsa2025 = hsaYears.find((y) => y.year === 2025);
const shaharYears = eduReconYearsFor(docs, CHILDREN[0], {});
const downstream = {
  retirement: k401StatementFacts(docs, "assaf")?.balance === 271019.12,
  hsa: hsa2026?.distributions === 5309.46,
  education: CHILDREN.every((c) => eduResolutionFor(docs, c.id).fields.ending_balance.value !== null),
  taxHistory2025: hsa2025?.source === "1099-SA" && hsa2025?.distributions === 7743.99,
};
const result = {
  filesEvidence: "5/5",
  accountsUpdated: accountIds.size,
  historicalTaxForms: docs.filter((d) => d.docType === "hsa_1099_sa" || d.docType === "hsa_5498_sa").length,
  duplicateFactsCreated: B.records - A.records,
  conflictsUnresolved: B.conflicts,
  downstream,
  tasks: {
    hsaReceiptsUnresolved: hsa2026?.unverified ?? null,
    shahar529Unresolved: shaharYears.find((y) => y.year === 2026)?.unverified ?? null,
  },
};
console.log("\nINGESTION RESULT (computed from the double-ingestion state)");
console.log(`Files/evidence: ${result.filesEvidence}`);
console.log(`Accounts updated: ${result.accountsUpdated}`);
console.log(`Historical tax forms: ${result.historicalTaxForms}`);
console.log(`Duplicate facts created: ${result.duplicateFactsCreated}`);
console.log(`Conflicts unresolved: ${result.conflictsUnresolved}`);
console.log("Downstream updates:");
console.log(`  Retirement recalculated: ${result.downstream.retirement}`);
console.log(`  HSA recalculated: ${result.downstream.hsa}`);
console.log(`  Education recalculated: ${result.downstream.education}`);
console.log(`  2025 HSA tax history reconciled: ${result.downstream.taxHistory2025}`);
console.log("Tasks:");
console.log(`  HSA receipts $${result.tasks.hsaReceiptsUnresolved?.toLocaleString("en-US", { minimumFractionDigits: 2 })} unresolved`);
console.log(`  Shahar 529 $${result.tasks.shahar529Unresolved?.toLocaleString("en-US", { minimumFractionDigits: 2 })} unresolved`);
console.log("Full derived task list:");
for (const t of B.tasks) console.log(`  ${t}`);

check("RESULT: accounts updated", result.accountsUpdated, 5);
check("RESULT: historical tax forms", result.historicalTaxForms, 2);
check("RESULT: duplicate facts created", result.duplicateFactsCreated, 0);
check("RESULT: conflicts unresolved", result.conflictsUnresolved, 0);
check("RESULT: downstream updates all fired", result.downstream, { retirement: true, hsa: true, education: true, taxHistory2025: true });
check("RESULT: HSA receipts unresolved", result.tasks.hsaReceiptsUnresolved, 5309.46);
check("RESULT: Shahar 529 unresolved", result.tasks.shahar529Unresolved, 14733.34);

console.log(`\nround58-harness: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
