// PDF text-layer reading - WEB implementation (Metro resolves this
// .web variant for web builds). Uses pdf.js locally in the browser:
// the picked file is read on this device only, nothing is uploaded.
// Tax PDFs (returns, statements, 1099s) are generated with a real text
// layer, so extraction quality matches the paste-text path and every
// field is still user-confirmed before saving.
//
// LOADING RULE (white-page incident, 2026-11-07): pdf.js is loaded
// LAZILY, inside this action only - never at module scope. Bisect
// proof: the statically-imported pdfjs-dist 6.5.438 legacy build
// crashed the whole app at startup (blank page in Chromium and iOS
// Safari); the identical build without it rendered fine. A lazy load
// inside an explicit user action is not the TReps failure mode (that
// was a silent-catch dynamic import gating a STATUS): here every load
// or parse failure returns as a stage result shown in the UI.
// Worker version pinned to the installed pdfjs-dist version (6.5.438).
export interface PdfTextOutcome {
  text: string;
  stage: string;
  error?: string;
}

interface TextItemLike {
  str: string;
  transform?: number[];
}

export async function extractPdfText(uri: string): Promise<PdfTextOutcome> {
  let pdfjs: typeof import("pdfjs-dist/legacy/build/pdf.mjs");
  try {
    pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/legacy/build/pdf.worker.min.mjs";
  } catch (e) {
    return { text: "", stage: "pdf-load", error: e instanceof Error ? e.message : String(e) };
  }
  try {
    const data = await (await fetch(uri)).arrayBuffer();
    const pdf = await pdfjs.getDocument({ data }).promise;
    const pages: string[] = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const lines: string[] = [];
      let line = "";
      let lastY: number | null = null;
      for (const item of content.items as TextItemLike[]) {
        const y = item.transform?.[5] ?? null;
        if (lastY !== null && y !== null && y !== lastY && line) {
          lines.push(line);
          line = "";
        }
        line += (line && !line.endsWith(" ") ? " " : "") + item.str;
        if (y !== null) lastY = y;
      }
      if (line) lines.push(line);
      pages.push(lines.join("\n"));
    }
    const text = pages.join("\n");
    if (!text.trim()) {
      return {
        text: "",
        stage: "pdf",
        error: "This PDF has no readable text layer (it looks like a scanned image). Photograph the pages instead, or paste the text.",
      };
    }
    return { text, stage: "pdf" };
  } catch (e) {
    return { text: "", stage: "pdf", error: e instanceof Error ? e.message : String(e) };
  }
}
