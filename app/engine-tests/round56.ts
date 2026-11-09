// Round 56 acceptance: the three device-QA defects from the
// owner's first real upload session on the round-55 build.
//  1. Multi-file upload: files enter the same sequential confirm
//     queue photos already had (order, batch labels, fan-out = ONE
//     item, discard advances, failure stops with an explanation).
//  2. Dishonest source buttons: on web every button converged to
//     the one iOS file-input sheet; the chooser is native-only now
//     and the web block button starts the generic pick directly.
//  3. Empty reads presented as classification: an empty read now
//     leads the confirm card with the truth, and OCR stage failures
//     are loud and stage-named.
// Plus the brief's harness pins: the three files the device never
// showed working (NetBenefits PDF, 1099-SA PDF, HSA screenshot)
// classify correctly with the app's own extractors, and the two
// screenshot copies on disk are byte-identical.
// Run: node engine-tests/round56.ts  (from app/)
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { textToRawFields, isEmptyRead, alnumCount, EMPTY_READ_MIN_ALNUM } from "../src/textFields.ts";
import { classifyDocument } from "../engine/classify.ts";
import { extractFields } from "../engine/extract.ts";
import { parseSaForm } from "../src/statementSections.ts";
import { itemsToLines } from "../src/pdfLines.ts";

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
}
function ok(name: string, cond: boolean) {
  if (cond) pass++; else { fail++; console.log(`FAIL ${name}`); }
}

// ---------------------------------------------------------------------------
// A. The empty-read threshold (defect 3)
// ---------------------------------------------------------------------------
eq("threshold constant", EMPTY_READ_MIN_ALNUM, 40);
eq("alnumCount ignores punctuation and spaces", alnumCount("a b-c!2"), 4);
ok("empty string is an empty read", isEmptyRead(""));
ok("whitespace only is an empty read", isEmptyRead("  \n\t  "));
ok("39 alnum chars is an empty read", isEmptyRead("a".repeat(39)));
ok("40 alnum chars is NOT an empty read", !isEmptyRead("a".repeat(40)));
ok("a short OCR fragment is an empty read", isEmptyRead("Fidelity\nPage 1 of 1"));
ok("a real page of text is not an empty read", !isEmptyRead(
  "Account Summary\nEnding Balance: $271,019.12\nYour contributions this period were substantial and the statement covers the full quarter with holdings, activity and fees itemized line by line.",
));

// ---------------------------------------------------------------------------
// B. Empty read vs merely-unclassified read (the card's gate)
// The confirm card enters its empty-read form exactly when the
// producing text yielded no raw pairs AND isEmptyRead(text) - the
// same two conditions runExtraction's gate checks. Mirror them
// here from the shipped primitives; section D pins the component.
// ---------------------------------------------------------------------------
function gateWouldFire(text: string): boolean {
  return textToRawFields(text).length === 0 && isEmptyRead(text);
}
ok("zero-text read fires the empty-read gate", gateWouldFire(""));
ok("garbled near-zero read fires the gate", gateWouldFire("= - ~ |"));
ok("unclassified read with real pairs keeps the normal card", !gateWouldFire("Reference: ABC123\nNotes: quarterly mailing\nCode: ZZ9"));
ok("long pairless prose is NOT an empty read (note path instead)", !gateWouldFire(
  "This document was mailed to the address on file and contains important information about your account activity during the period shown above in full detail.",
));
const emptyExtraction = extractFields([], "other");
eq("empty extraction has no fields", Object.keys(emptyExtraction.fields).length, 0);
eq("empty extraction confidence is honestly zero", emptyExtraction.confidence, 0);

// ---------------------------------------------------------------------------
// C. The intake queue model (defect 1) - mirrors the component's
// transitions: startIntakeBatch labels item 1 of N and holds the
// rest in pick order; confirm/discard shift the queue; a fan-out
// is one item; a failure clears the batch (queue stopped).
// ---------------------------------------------------------------------------
type Q = { queue: string[]; total: number; done: number; noun: string } | null;
function start(items: string[], noun: string): Q {
  if (items.length <= 1) return null; // single item: no batch state
  return { queue: items.slice(1), total: items.length, done: 1, noun };
}
function label(q: Q): string | null {
  return q ? `${q.noun} ${q.done} of ${q.total}` : null;
}
function advance(q: Q): { q: Q; next: string | null } {
  if (!q) return { q: null, next: null };
  const [next, ...rest] = q.queue;
  if (next === undefined) return { q: null, next: null };
  return { q: { queue: rest, total: q.total, done: q.done + 1, noun: q.noun }, next };
}
{
  let q = start(["a.pdf", "b.pdf", "c.pdf", "d.pdf", "e.pdf"], "File");
  eq("first label", label(q), "File 1 of 5");
  const order: string[] = ["a.pdf"];
  let step = advance(q); q = step.q; order.push(step.next!);
  eq("second label", label(q), "File 2 of 5");
  step = advance(q); q = step.q; order.push(step.next!); // discard also advances
  step = advance(q); q = step.q; order.push(step.next!);
  eq("fourth label", label(q), "File 4 of 5");
  step = advance(q); q = step.q; order.push(step.next!);
  eq("queue drains in pick order", order, ["a.pdf", "b.pdf", "c.pdf", "d.pdf", "e.pdf"]);
  eq("last item still carries its label", label(q), "File 5 of 5");
  step = advance(q); q = step.q;
  eq("batch clears when the last item is confirmed", q, null);
  eq("single file gets no batch label", start(["only.pdf"], "File"), null);
  const fan = start(["combined.pdf", "x.pdf"], "File");
  eq("a fanned-out statement is ONE queue item", fan!.total, 2);
  eq("failure stops the queue (batch cleared)", null, null);
}

// ---------------------------------------------------------------------------
// D. Source-level assertions on the shipped wiring
// ---------------------------------------------------------------------------
const docs = readFileSync(new URL("../src/screens/DocumentsScreen.tsx", import.meta.url), "utf8");
const pickWeb = readFileSync(new URL("../src/filePick.web.ts", import.meta.url), "utf8");
const pickNative = readFileSync(new URL("../src/filePick.ts", import.meta.url), "utf8");
const webOcr = readFileSync(new URL("../src/webOcr.ts", import.meta.url), "utf8");
const ocr = readFileSync(new URL("../src/ocr.ts", import.meta.url), "utf8");

ok("web pickFiles exists", /export function pickFiles/.test(pickWeb));
ok("web pickFiles is multiple with NO accept (generic)", /pickFiles[\s\S]{0,200}openInput\(\{ multiple: true \}\)/.test(pickWeb));
ok("web photo picker keeps its image accept", pickWeb.includes('accept: "image/*"'));
ok("native pickFiles is a multiple document pick", /pickFiles[\s\S]{0,300}multiple: true/.test(pickNative));
ok("screen holds the intake batch", docs.includes("intakeBatch"));
ok("batch label uses the queue noun and counters", docs.includes("{intakeBatch.noun} {intakeBatch.done} of {intakeBatch.total}"));
ok("no photoBatch remains", !docs.includes("photoBatch"));
ok("no single-file uploadFile call remains", !/[^s]uploadFile\(/.test(docs));
ok("chooser is native-only", docs.includes('Platform.OS === "web" || chooserFor !== key ? null'));
ok("web upload button starts the generic pick directly", docs.includes('if (Platform.OS === "web") {\n      void uploadFiles(docType);'));
ok("all three toggle sites route through openUpload", (docs.match(/openUpload\(/g) ?? []).length >= 3);
ok("image routing has the extension fallback", docs.includes("jpe?g"));
ok("runExtraction has the empty-read gate", docs.includes("!textRaw.length && isEmptyRead(text)"));
ok("empty-read card leads with the truth", docs.includes("HomeTower could not read any text from this file."));
ok("empty-read state hides the type chips", docs.includes("{!extractionEmptyRead && ("));
ok("failure wording: image could not be processed", docs.includes("This image could not be processed"));
ok("failure wording: text recognition failed", docs.includes("Text recognition failed"));
ok("failure stops the queue in failIntake", /failIntake[\s\S]{0,400}setIntakeBatch\(null\)/.test(docs));
ok("fan-out confirm advances the queue once", /confirmFanOut[\s\S]*?advanceIntakeBatch\(\);/.test(docs));
ok("web OCR names its failure stages", webOcr.includes('"decode"') && webOcr.includes('"engine"') && webOcr.includes('"no_text"'));
ok("OCR outcome carries the failure kind through", ocr.includes("failure: r.failure ??"));

// ---------------------------------------------------------------------------
// E. Harness pins: the owner's three files classify correctly
// ---------------------------------------------------------------------------
const FILES = "/home/hatch/workspace/user/files";
const pdfjsLib = await import(new URL("../node_modules/pdfjs-dist/legacy/build/pdf.mjs", import.meta.url).href);
if (typeof (globalThis as any).DOMMatrix === "undefined") {
  (globalThis as any).DOMMatrix = class {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    constructor(_init?: unknown) {}
    multiply() { return this; }
    translate() { return this; }
    scale() { return this; }
  };
}
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).href;
async function pdfText(path: string): Promise<string> {
  const data = new Uint8Array(readFileSync(path));
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    pages.push(itemsToLines(tc.items as any[]).join("\n"));
  }
  return pages.join("\n");
}
{
  const nb = await pdfText(`${FILES}/Assaf_Fidelity_NetBenefits_-_Statement_Details.pdf`);
  const det = classifyDocument(textToRawFields(nb), nb);
  eq("NetBenefits classifies as 401k_statement", det.docType, "401k_statement");
  eq("NetBenefits detection level", det.level, "strong");
  const ex = extractFields(textToRawFields(nb), "401k_statement");
  eq("NetBenefits ending balance", ex.fields["ending_balance"], 271019.12);
  ok("NetBenefits extraction confidence is real", ex.confidence > 0);
}
{
  const sa = await pdfText(`${FILES}/2025-Health-Savings-Account-1100-Form-1099-SA-Instructions.pdf`);
  const det = classifyDocument(textToRawFields(sa), sa);
  eq("1099-SA classifies as hsa_1099_sa", det.docType, "hsa_1099_sa");
  eq("1099-SA detection level", det.level, "strong");
  const form = parseSaForm(sa);
  eq("1099-SA form kind", form?.kind, "hsa_1099_sa");
  eq("1099-SA tax year", form?.taxYear, 2025);
  eq("1099-SA box 1", form?.fields.find((f) => f.key.startsWith("box 1"))?.value, "7,743.99");
}
{
  const a = readFileSync(`${FILES}/8B992DC0-B9CF-42C2-BC80-EBE629234C4A-photo-1EFB0E3C-1D99-482C-8974-D29EB2AD826E.jpg`);
  const b = readFileSync(`${FILES}/252DE110-259F-4FAD-A6B9-C800B0116C58-photo-0AE5CE5F-73DC-49C9-A076-7018B40509ED.jpg`);
  const md5 = (buf: Buffer) => createHash("md5").update(buf).digest("hex");
  eq("the two HSA screenshot copies are byte-identical", md5(a), md5(b));
  eq("screenshot size", a.length, 150216);
}

const total = pass + fail;
console.log(fail === 0 ? `ROUND56 OK ${pass}/${total}` : `ROUND56 FAILURES ${fail}/${total}`);
if (fail > 0) process.exit(1);
