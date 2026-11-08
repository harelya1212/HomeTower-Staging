// Web OCR for photos and screenshots (tesseract.js) - used by the
// web build, where on-device ML Kit does not exist.
//
// LOADING RULE (the pdf.js lesson, rounds 6-12): the OCR library must
// NOT travel through Metro. It loads here with a plain <script> tag
// from the pinned CDN, inside the user action only, and every failure
// returns as a stage result shown in the UI. The image itself is read
// locally in the browser and never leaves the device - only the
// library code loads. The worker is created once and reused, so a
// batch of screenshots pays the load cost on the first one only.
//
// Proven on a real E*TRADE screenshot before wiring (diag page,
// 2026-11-07): full read in ~6s, positions and figures legible.
export interface WebOcrOutcome {
  text: string;
  stage: string;
  error: string | null;
}

const LIB_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.0.5/dist/tesseract.min.js";
const WORKER_OPTS = {
  workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@5.0.5/dist/worker.min.js",
  corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.0.0/tesseract-core-simd.wasm.js",
  langPath: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0",
};

type TesseractLib = {
  createWorker: (langs: string, oem: number, opts: Record<string, unknown>) => Promise<{
    recognize: (image: File | Blob) => Promise<{ data: { text: string } }>;
  }>;
};

let libPromise: Promise<TesseractLib> | null = null;
let workerPromise: Promise<Awaited<ReturnType<TesseractLib["createWorker"]>>> | null = null;

function loadLib(): Promise<TesseractLib> {
  if (libPromise) return libPromise;
  libPromise = new Promise((resolve, reject) => {
    const w = window as unknown as { Tesseract?: TesseractLib };
    if (w.Tesseract) {
      resolve(w.Tesseract);
      return;
    }
    const script = document.createElement("script");
    script.src = LIB_URL;
    script.onload = () => {
      if (w.Tesseract) resolve(w.Tesseract);
      else reject(new Error("OCR library loaded but did not initialize."));
    };
    script.onerror = () => reject(new Error("Could not load the OCR library from the CDN (check the connection)."));
    document.head.appendChild(script);
  });
  return libPromise;
}

export async function recognizeWithWebOcr(file: File | Blob, onProgress?: (pct: number) => void): Promise<WebOcrOutcome> {
  try {
    if (!workerPromise) {
      const lib = await loadLib();
      workerPromise = lib.createWorker("eng", 1, {
        ...WORKER_OPTS,
        logger: (m: { status: string; progress: number }) => {
          if (m.status === "recognizing text" && onProgress) onProgress(Math.round((m.progress || 0) * 100));
        },
      });
    }
    const worker = await workerPromise;
    const { data } = await worker.recognize(file);
    if (!data.text.trim()) {
      return { text: "", stage: "web-ocr", error: "Web OCR found no text in this image." };
    }
    return { text: data.text, stage: "web-ocr", error: null };
  } catch (e) {
    return { text: "", stage: "web-ocr", error: e instanceof Error ? e.message : String(e) };
  }
}
