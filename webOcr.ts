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
async function decodeImage(file: File | Blob): Promise<{ img: HTMLImageElement; url: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("image decode failed"));
      el.src = url;
    });
    return { img, url };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

async function sliceBand(img: HTMLImageElement, y0: number, y1: number, scale: number): Promise<Blob | null> {
  const w = img.naturalWidth;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round((y1 - y0) * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, y0, w, y1 - y0, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
}

async function splitTallImage(file: File | Blob): Promise<Blob[] | null> {
  try {
    const { img, url } = await decodeImage(file);
    try {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!w || !h || h < w * 1.5) return null; // not a tall capture - single pass
      const cut = Math.floor(h * 0.42); // first half 0-58%, second 42-100% (16% overlap)
      const parts: Blob[] = [];
      for (const [y0, y1] of [[0, Math.floor(h * 0.58)], [cut, h]] as Array<[number, number]>) {
        const blob = await sliceBand(img, y0, y1, 1);
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

export interface WebBandsOutcome {
  texts: string[];
  stage: string;
  error: string | null;
}

// Section re-read (owner demand, 2026-11-08 - "fix the app so it
// reads the files correctly"): when the fast pass over a tall
// screenshot loses a whole table, re-read the image in SMALL,
// ENLARGED horizontal bands. Each band is an ordinary, near-300-dpi
// page for the segmenter instead of one extreme strip with ~15px
// digits - the conditions under which the engine stops dropping
// blocks. Bands overlap by 24% so no table row is ever cut in two
// in every band. The caller extracts fields per band and fills only
// what the fast pass missed, so a band can rescue a reading but
// never override it.
const BAND_H = 950; // source px per band
const BAND_OVERLAP = 0.24;
const BAND_SCALE = 2; // enlarge: phone screenshots are ~150 dpi
const MAX_BANDS = 6;

export async function recognizeBandsWebOcr(file: File | Blob, onProgress?: (pct: number) => void): Promise<WebBandsOutcome> {
  try {
    const { img, url } = await decodeImage(file);
    try {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!w || !h || h < w * 1.2) return { texts: [], stage: "web-ocr-bands", error: null }; // not tall - nothing to rescue
      const step = Math.round(BAND_H * (1 - BAND_OVERLAP));
      const ranges: Array<[number, number]> = [];
      for (let y = 0; y < h && ranges.length < MAX_BANDS; y += step) {
        ranges.push([y, Math.min(h, y + BAND_H)]);
        if (ranges[ranges.length - 1][1] === h) break;
      }
      const worker = await getWorker();
      const texts: string[] = [];
      for (let i = 0; i < ranges.length; i++) {
        const blob = await sliceBand(img, ranges[i][0], ranges[i][1], BAND_SCALE);
        if (!blob) continue;
        const { data } = await worker.recognize(blob);
        if (data.text.trim()) texts.push(data.text);
        if (onProgress) onProgress(Math.round(((i + 1) / ranges.length) * 100));
      }
      return { texts, stage: "web-ocr-bands", error: null };
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (e) {
    return { texts: [], stage: "web-ocr-bands", error: e instanceof Error ? e.message : String(e) };
  }
}
