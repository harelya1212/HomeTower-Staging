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
