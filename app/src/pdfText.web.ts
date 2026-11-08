// PDF text-layer reading - WEB implementation (Metro resolves this
// .web variant for web builds). The picked file is read on this device
// only, nothing is uploaded. Tax PDFs (returns, statements, 1099s) are
// generated with a real text layer, so extraction quality matches the
// paste-text path and every field is still user-confirmed before
// saving.
//
// LOADING HISTORY (three incidents, one conclusion - pdf.js must not
// travel through Metro at all):
// 1. Static import (round 6) crashed the app at startup (white page).
// 2. Metro lazy chunk (rounds 7-11) reached the owner's phone with an
//    inconsistent module graph: "Requiring unknown module 813", then
//    "814" after the next build - Metro's splitter mis-registers this
//    library's entry module between the main bundle and the chunk.
// 3. Therefore: the library loads with the BROWSER'S OWN module
//    loader, straight from the pinned CDN (the exact version that is
//    also in package.json), inside this user action only. Metro never
//    sees the import (it is constructed at runtime), no chunk pairing
//    exists, and every failure returns as a stage result in the UI.
//    The worker already loaded from this CDN since round 6; the
//    DOCUMENT never leaves the device - only the library code loads.
import { itemsToLines, type TextItemLike } from "./pdfLines.ts";
import { columnRawFields } from "./pdfColumns.ts";
import type { RawField } from "../engine/extract.ts";

export interface PdfTextOutcome {
  text: string;
  pages: string[];
  /** Column-aware label-value pairs per page (form PDFs like the
   * 1040, whose value column detaches from its labels in plain text). */
  columnByPage: RawField[][];
  stage: string;
  error?: string;
}

export async function extractPdfText(uri: string): Promise<PdfTextOutcome> {
  try {
    const data = await (await fetch(uri)).arrayBuffer();
    return await extractPdfTextFromBuffer(data);
  } catch (e) {
    return { text: "", pages: [], columnByPage: [], stage: "pdf", error: e instanceof Error ? e.message : String(e) };
  }
}

export async function extractPdfTextFromBuffer(data: ArrayBuffer): Promise<PdfTextOutcome> {
  let pdfjs: typeof import("pdfjs-dist/legacy/build/pdf.mjs");
  try {
    // Browser-native module load from the pinned CDN - deliberately
    // constructed at runtime so Metro cannot rewrite it into its own
    // (broken, for this library) chunk graph. See the header history.
    const nativeImport = new Function("url", "return import(url)") as (url: string) => Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")>;
    pdfjs = await nativeImport("https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/legacy/build/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/legacy/build/pdf.worker.min.mjs";
  } catch (e) {
    return { text: "", pages: [], columnByPage: [], stage: "pdf-load", error: e instanceof Error ? e.message : String(e) };
  }
  try {
    const pdf = await pdfjs.getDocument({ data }).promise;
    const pages: string[] = [];
    const columnByPage: RawField[][] = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      // Geometry-based reconstruction (src/pdfLines.ts): word
      // fragments are joined without spaces, real word gaps get one
      // space - the naive join made every label unmatchable.
      pages.push(itemsToLines(content.items as TextItemLike[]).join("\n"));
      // Column-aware pairs from the same items (src/pdfColumns.ts).
      columnByPage.push(
        columnRawFields(
          (content.items as Array<{ str: string; transform: number[]; width: number }>).map((i) => ({
            str: i.str,
            x: i.transform[4],
            y: i.transform[5],
            width: i.width,
          })),
        ),
      );
    }
    const text = pages.join("\n");
    if (!text.trim()) {
      return {
        text: "",
        pages,
        columnByPage,
        stage: "pdf",
        error: "This PDF has no readable text layer (it looks like a scanned image). Photograph the pages instead, or paste the text.",
      };
    }
    return { text, pages, columnByPage, stage: "pdf" };
  } catch (e) {
    return { text: "", pages: [], columnByPage: [], stage: "pdf", error: e instanceof Error ? e.message : String(e) };
  }
}
