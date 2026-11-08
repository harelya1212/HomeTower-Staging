// Web file picking: a real DOM <input type="file">.
//
// expo-document-picker's web shim resolves WITHOUT assets inside an
// iOS standalone web app (owner QA round 9: "I tap, the window opens,
// I pick a file, the window closes - but there is no file"). The
// promise came back with no uri and no error, so the upload died
// silently. The DOM input is the platform's own control and returns
// the actual File object - no shim in between. Metro resolves this
// .web variant for web builds (extensionless import - see pdfText).
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

export function pickFile(): Promise<PickedFile> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.style.display = "none";
    document.body.appendChild(input);
    let settled = false;
    const done = (r: PickedFile) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("focus", onFocus);
      input.remove();
      resolve(r);
    };
    const onFocus = () => {
      // iOS fires no event when the picker is cancelled: when the app
      // regains focus and no change arrived, call it a cancel after a
      // short grace period (a real selection's change event wins).
      setTimeout(() => done({ name: "", cancelled: true }), 600);
    };
    input.addEventListener("change", () => {
      const f = input.files?.[0];
      if (f) done({ file: f, name: f.name });
      else done({ name: "", cancelled: true });
    });
    window.addEventListener("focus", onFocus);
    input.click();
  });
}

/** Multi-photo picking on web (owner QA round 25): the photo-library
 * shim behind expo-image-picker resolves empty inside an iOS
 * standalone web app - the user picks, taps the checkmark, and
 * nothing arrives, silently. Same disease as the document picker in
 * round 9, same cure: the platform's own file input, here with
 * accept="image/*" and multiple selection. */
export function pickImageFiles(): Promise<PickedImages> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.style.display = "none";
    document.body.appendChild(input);
    let settled = false;
    const done = (r: PickedImages) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("focus", onFocus);
      input.remove();
      resolve(r);
    };
    const onFocus = () => {
      setTimeout(() => done({ files: [], cancelled: true }), 600);
    };
    input.addEventListener("change", () => {
      const files = input.files ? Array.from(input.files) : [];
      if (files.length) done({ files });
      else done({ files: [], cancelled: true });
    });
    window.addEventListener("focus", onFocus);
    input.click();
  });
}
