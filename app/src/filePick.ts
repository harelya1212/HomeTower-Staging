// File picking - native/default variant (Metro resolves the .web
// variant for web builds; import this module extensionless).
// Native uses expo-document-picker, which works correctly there.
import * as DocumentPicker from "expo-document-picker";

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

/** Native photo picking goes through expo-image-picker (ocr.ts);
 * this DOM-input variant exists for web builds only. */
export async function pickImageFiles(): Promise<PickedImages> {
  return { files: [], error: "Photo file picking is a web path; the native app uses the photo library picker." };
}

export async function pickFile(): Promise<PickedFile> {
  try {
    const result = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.[0]) return { name: "", cancelled: true };
    const a = result.assets[0];
    return { uri: a.uri, name: a.name ?? "document" };
  } catch (e) {
    return { name: "", error: e instanceof Error ? e.message : String(e) };
  }
}
