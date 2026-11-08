// PDF text-layer reading - native/default platform.
// The real implementation is pdfText.web.ts (Metro resolves the .web
// variant for web builds): PDFs from tax software carry a text layer,
// read locally in the browser with pdf.js - the file never leaves the
// device. On native, PDF text reading is not wired yet, and this stub
// says so as a stage result shown in the UI (never a silent failure).
import type { RawField } from "../engine/extract.ts";

export interface PdfTextOutcome {
  text: string;
  pages: string[];
  columnByPage: RawField[][];
  stage: string;
  error?: string;
}

export async function extractPdfText(_uri: string): Promise<PdfTextOutcome> {
  return {
    text: "",
    pages: [],
    columnByPage: [],
    stage: "pdf",
    error: "PDF text reading runs in the web app for now. In the phone app, photograph the pages or paste the text instead.",
  };
}

export async function extractPdfTextFromBuffer(_data: ArrayBuffer): Promise<PdfTextOutcome> {
  return {
    text: "",
    pages: [],
    columnByPage: [],
    stage: "pdf",
    error: "PDF text reading runs in the web app for now. In the phone app, photograph the pages or paste the text instead.",
  };
}
