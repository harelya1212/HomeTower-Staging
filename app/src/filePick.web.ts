// Web file picking: a real DOM <input type="file">.
//
// expo-document-picker's web shim resolves WITHOUT assets inside an
// iOS standalone web app (owner QA round 9: "I tap, the window opens,
// I pick a file, the window closes - but there is no file"). The
// promise came back with no uri and no error, so the upload died
// silently. The DOM input is the platform's own control and returns
// the actual File object - no shim in between. Metro resolves this
// .web variant for web builds (extensionless import - see pdfText).
//
// ROUND 56 (device QA defects 1 + 2): every picker in this module is
// the same DOM input with different parameters, and the parameters
// are the whole story. iOS in a standalone web app presents ONE
// system sheet (Photo Library / Take Photo / Choose Files) for any
// file input - it ignores the capture attribute there, and accept
// only filters what can be picked inside a source, never which
// sources are offered. So on web no per-source button can keep a
// "library" or "camera" promise; the app therefore offers ONE
// generic multi-file pick and routes each picked file by content.
export interface PickedFile {
  file?: File;
  uri?: string;
  name: string;
  cancelled?: boolean;
  error?: string;
}

export interface PickedImages {
  files: File[];
  cancelled?: boolean;
  error?: string;
}

export interface PickedFiles {
  files: PickedFile[];
  cancelled?: boolean;
  error?: string;
}

function openInput(opts: { accept?: string; multiple?: boolean }): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    if (opts.accept) input.accept = opts.accept;
    if (opts.multiple) input.multiple = true;
    input.style.display = "none";
    document.body.appendChild(input);
    let settled = false;
    const done = (files: File[]) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("focus", onFocus);
      input.remove();
      resolve(files);
    };
    const onFocus = () => {
      // iOS fires no event when the picker is cancelled: when the app
      // regains focus and no change arrived, call it a cancel after a
      // short grace period (a real selection's change event wins).
      setTimeout(() => done([]), 600);
    };
    input.addEventListener("change", () => {
      done(input.files ? Array.from(input.files) : []);
    });
    window.addEventListener("focus", onFocus);
    input.click();
  });
}

export function pickFile(): Promise<PickedFile> {
  return openInput({}).then((files) =>
    files.length ? { file: files[0], name: files[0].name } : { name: "", cancelled: true },
  );
}

/** Round 56: multi-file picking - several documents in one selection
 * (the Files browser allows it; the app confirms them one at a time
 * from its intake queue). No accept restriction: PDFs, CSVs and
 * images may be mixed in one pick, each routed by its content. */
export function pickFiles(): Promise<PickedFiles> {
  return openInput({ multiple: true }).then((files) =>
    files.length
      ? { files: files.map((f) => ({ file: f, name: f.name })) }
      : { files: [], cancelled: true },
  );
}

/** Multi-photo picking on web (owner QA round 25): the photo-library
 * shim behind expo-image-picker resolves empty inside an iOS
 * standalone web app - the user picks, taps the checkmark, and
 * nothing arrives, silently. Same disease as the document picker in
 * round 9, same cure: the platform's own file input, here with
 * accept="image/*" and multiple selection. */
export function pickImageFiles(): Promise<PickedImages> {
  return openInput({ accept: "image/*", multiple: true }).then((files) =>
    files.length ? { files } : { files: [], cancelled: true },
  );
}
