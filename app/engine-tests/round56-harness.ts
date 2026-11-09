// Round 56 harness - NOT a pass/fail suite (round56.ts pins the
// assertions). This prints the classification evidence the round-56
// brief demands, using the app's own extractors:
//  1. NetBenefits 401(k) PDF (device: never seen working) - pdf.js
//     text, the same itemsToLines the app uses, then the app's
//     classifier + field extraction.
//  2. 1099-SA PDF (device: never seen working) - same path + the SA
//     form parser.
//  3. BOTH copies of the Fidelity HSA screenshot (the file that
//     produced the device's confidence-0 card) through the same
//     single tesseract pass the app's web path runs for a wide
//     screenshot, then parseHsaPageFields' balance proximity rule.
// Run from app/: node engine-tests/round56-harness.ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { textToRawFields } from "../src/textFields.ts";
import { classifyDocument } from "../engine/classify.ts";
import { extractFields } from "../engine/extract.ts";
import { parseHsaPageFields, parseSaForm } from "../src/statementSections.ts";
import { itemsToLines } from "../src/pdfLines.ts";

const FILES = "/home/hatch/workspace/user/files";

// ---- pdf.js (the app's extractor), set up exactly as round55 ----
const pdfjsLib = await import(
  new URL("../node_modules/pdfjs-dist/legacy/build/pdf.mjs", import.meta.url).href
);
if (typeof (globalThis as any).DOMMatrix === "undefined") {
  (globalThis as any).DOMMatrix = class {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    constructor(_init?: unknown) {}
    multiply() { return this; }
    translate() { return this; }
    scale() { return this; }
  };
}
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
  import.meta.url,
).href;

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

function report(name: string, text: string) {
  const raw = textToRawFields(text);
  const det = classifyDocument(raw, text);
  console.log("\n== " + name);
  console.log("   text chars: " + text.length + ", raw pairs: " + raw.length);
  console.log("   detection: " + det.docType + " (" + det.level + ") signals: " + det.signals.join(", "));
  return det;
}

// ---- 1. NetBenefits 401(k) statement ----
{
  const text = await pdfText(FILES + "/Assaf_Fidelity_NetBenefits_-_Statement_Details.pdf");
  const det = report("NetBenefits 401(k) PDF", text);
  const ex = extractFields(textToRawFields(text), "401k_statement");
  console.log("   extraction as 401k_statement: confidence " + ex.confidence + ", status " + ex.status);
  for (const k of ["ending_balance", "employer_match_ytd", "employee_contrib_401k_ytd", "after_tax_contrib_ytd", "total_contributions_415_ytd"]) {
    console.log("   " + k + ": " + String(ex.fields[k]));
  }
  console.log("   (detection docType = " + det.docType + ")");
}

// ---- 2. 1099-SA ----
{
  const text = await pdfText(FILES + "/2025-Health-Savings-Account-1100-Form-1099-SA-Instructions.pdf");
  const det = report("1099-SA PDF", text);
  const sa = parseSaForm(text);
  console.log("   parseSaForm: " + JSON.stringify(sa));
  console.log("   (detection docType = " + det.docType + ")");
}

// ---- 3. Both copies of the HSA screenshot through tesseract ----
const require56 = createRequire("/tmp/r56/ocr/package.json");
const { createWorker } = require56("tesseract.js");
const worker = await createWorker("eng", 1, {
  langPath: "/tmp/r56/ocr",
  gzip: true,
  cachePath: "/tmp/r56/ocr/cache",
  logger: () => {},
});
const copies = [
  FILES + "/8B992DC0-B9CF-42C2-BC80-EBE629234C4A-photo-1EFB0E3C-1D99-482C-8974-D29EB2AD826E.jpg",
  FILES + "/252DE110-259F-4FAD-A6B9-C800B0116C58-photo-0AE5CE5F-73DC-49C9-A076-7018B40509ED.jpg",
];
const md5s: string[] = [];
for (const path of copies) {
  const buf = readFileSync(path);
  const md5 = createHash("md5").update(buf).digest("hex");
  md5s.push(md5);
  const { data } = await worker.recognize(path);
  const text = data.text ?? "";
  // The app's own fallback: page raw fields -> hsa_statement map.
  const pageRaw = parseHsaPageFields(text);
  const hsaEx = extractFields(pageRaw, "hsa_statement");
  console.log("\n== HSA screenshot copy: " + path.split("/").pop());
  console.log("   md5: " + md5 + ", bytes: " + buf.length);
  console.log("   tesseract chars: " + text.length + ", lines: " + text.split("\n").filter((l: string) => l.trim()).length);
  console.log("   '$13,769.61' verbatim in raw OCR: " + text.includes("$13,769.61"));
  console.log("   proximity rule ending_balance resolves to: " + String(hsaEx.fields["ending_balance"]));
}
await worker.terminate();
console.log("\n== the two copies are byte-identical: " + (md5s[0] === md5s[1]));
