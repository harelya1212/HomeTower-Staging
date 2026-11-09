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

async function getWorker(onProgress?: (pct: number) => void) {
  if (!workerPromise) {
    const lib = await loadLib();
    workerPromise = lib.createWorker("eng", 1, {
      ...WORKER_OPTS,
      logger: (m: { status: string; progress: number }) => {
        if (m.status === "recognizing text" && onProgress) onProgress(Math.round((m.progress || 0) * 100));
      },
    });
  }
  return workerPromise;
}

// Tall screenshots (a two-page payslip captured as one long image)
// make the OCR engine drop whole text blocks on memory-constrained
// devices - measured on the owner's phone (2026-11-08): the same
// engine read the same files completely in a desktop browser, but
// on-device entire sections (federal withholding, taxable wages)
// vanished from some readings. Reading a tall image in two
// overlapping halves gives the segmenter two ordinary pages instead
// of one extreme one; the overlap band repeats a few lines, which
// the field parser tolerates (first reading of a figure wins).
async function splitTallImage(file: File | Blob): Promise<Blob[] | null> {
  try {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("image decode failed"));
        el.src = url;
      });
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!w || !h || h < w * 1.5) return null; // not a tall capture - single pass
      const cut = Math.floor(h * 0.42); // first half 0-58%, second 42-100% (16% overlap)
      const parts: Blob[] = [];
      for (const [y0, y1] of [[0, Math.floor(h * 0.58)], [cut, h]] as Array<[number, number]>) {
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = y1 - y0;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(img, 0, y0, w, y1 - y0, 0, 0, w, y1 - y0);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
        if (!blob) return null;
        parts.push(blob);
      }
      return parts;
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}

export async function recognizeWithWebOcr(file: File | Blob, onProgress?: (pct: number) => void): Promise<WebOcrOutcome> {
  try {
    const worker = await getWorker(onProgress);
    const parts = await splitTallImage(file);
    if (parts && parts.length === 2) {
      const texts: string[] = [];
      for (let i = 0; i < parts.length; i++) {
        const { data } = await worker.recognize(parts[i]);
        if (data.text.trim()) texts.push(data.text);
        if (onProgress) onProgress(Math.round(((i + 1) / parts.length) * 100));
      }
      const text = texts.join("\n");
      if (!text.trim()) {
        return { text: "", stage: "web-ocr-split", error: "Web OCR found no text in this image." };
      }
      return { text, stage: "web-ocr-split", error: null };
    }
    const { data } = await worker.recognize(file);
    if (!data.text.trim()) {
      return { text: "", stage: "web-ocr", error: "Web OCR found no text in this image." };
    }
    return { text: data.text, stage: "web-ocr", error: null };
  } catch (e) {
    return { text: "", stage: "web-ocr", error: e instanceof Error ? e.message : String(e) };
  }
}
