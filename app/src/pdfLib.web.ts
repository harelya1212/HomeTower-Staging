// pdf.js holder - WEB. Imported ONLY dynamically from pdfText.web.ts,
// so Metro puts pdf.js in THIS chunk (pdfLib-<hash>). The chunk name
// changed on purpose in the round-11 fix: the old chunk was named
// "pdf-<hash>" across several deploys, and an iOS home-screen app
// holding a cached older generation of it crashed against a newer
// main bundle ("Requiring unknown module 813" - mixed generations).
// A chunk URL the cache has never seen cannot pair stale.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

export { pdfjs };
