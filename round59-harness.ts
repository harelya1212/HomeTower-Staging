// Round 59 harness - TRACE A diagnosis evidence, reproducible.
// Runs the app's OWN pinned web-OCR stack (tesseract.js 5.0.5 +
// tesseract.js-core 5.0.0 simd + @tesseract.js-data/eng 4.0.0 -
// the exact worker options in src/webOcr.ts) over the owner's
// real Fidelity HSA screenshot and degraded variants of it, then
// runs the app's extraction chain over each read:
//   variant            = the input image
//   chars              = OCR output length
//   pairs              = label-value pairs the generic pairing forms
//   classify           = the classifier's verdict on that text
//   page signature     = hsaPageDetectedFields (the round-59 read)
//   balance            = the balance the page read resolves
// The finding the round is built on: at native resolution the
// read is complete and the balance is verbatim - the device
// failure was NOT OCR quality but reachability (the page read
// was gated on the type being known first, and wide images had
// no retry pass). At half resolution the read collapses (~120
// chars, no pairs, no signature); enlarging that same degraded
// input back up (the shipped ladder's move) restores the
// signature and the exact balance; a harder degradation (half
// size + q60 JPEG) corrupts the figure itself and stays honestly
// unmatched even enlarged - the best achievable behavior there
// is the unmatched card showing what was read.
// Inputs (scratch, produced during the round-59 diagnosis):
//   HT_OCR_DIR  - dir whose node_modules hold tesseract.js 5.0.5
//                 (default /tmp/r59/app)
//   HT_OCR_DATA - dir holding eng.traineddata (default /tmp/r59/data-app)
//   HT_R59_OUT  - dir holding the variant images (default /tmp/r59/out)
// The suite (round59.ts) pins the durable half of this table from
// committed fixtures; this harness is the live re-run.
// Run: node engine-tests/round59-harness.ts
// @ts-nocheck - tesseract interop in a test harness
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { classifyDocument } from "../engine/classify.ts";
import { extractFields } from "../engine/extract.ts";
import { hsaPageDetectedFields } from "../src/statementSections.ts";
import { isEmptyRead, textToRawFields } from "../src/textFields.ts";

const OCR_DIR = process.env.HT_OCR_DIR ?? "/tmp/r59/app";
const OCR_DATA = process.env.HT_OCR_DATA ?? "/tmp/r59/data-app";
const OUT = process.env.HT_R59_OUT ?? "/tmp/r59/out";
const SHOT = "/home/hatch/workspace/user/files/252DE110-259F-4FAD-A6B9-C800B0116C58-photo-0AE5CE5F-73DC-49C9-A076-7018B40509ED.jpg";

const req = createRequire(`${OCR_DIR}/package.json`);
const Tesseract = req("tesseract.js");
// Same construction as the diagnosis script that produced the
// fixtures: default Node worker/core resolution from the pinned
// package, the pinned language data, OEM 1 - the app stack.
const worker = await Tesseract.createWorker("eng", 1, {
  langPath: OCR_DATA,
  gzip: true,
  cachePath: `${OCR_DATA}/cache`,
  logger: () => {},
});

const variants: Array<[string, string]> = [
  ["original (1290x681)", SHOT],
  ["half size, q85 jpeg", `${OUT}/v1-half-q85.jpg`],
  ["half size, enlarged x4 (the ladder)", `${OUT}/v1-up4x.png`],
  ["half size + q60 jpeg, enlarged x4", `${OUT}/v3-up4x.png`],
];
console.log("variant | chars | pairs | classify | empty? | page signature | balance");
for (const [name, path] of variants) {
  if (!existsSync(path)) { console.log(`${name} | MISSING (${path}) - regenerate the diagnosis variants to re-run this row`); continue; }
  const { data } = await worker.recognize(path);
  const text = data.text;
  const pairs = textToRawFields(text);
  const det = classifyDocument(pairs, text);
  const page = hsaPageDetectedFields(text);
  const bal = page ? extractFields(page, "hsa_statement").fields["ending_balance"] ?? null : null;
  console.log(`${name} | ${text.length} | ${pairs.length} | ${det.docType}/${det.level} | ${isEmptyRead(text)} | ${page !== null} | ${bal}`);
}
await worker.terminate();
