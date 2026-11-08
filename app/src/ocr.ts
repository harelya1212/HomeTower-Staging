// Document capture -> OCR text -> raw fields for the engine's extractor.
// Two text sources, one interface:
// - Native: ML Kit on-device text recognition from a picked photo.
// - Everywhere (incl. web): the user pastes text copied from a statement.
// The ML Kit load is a capability probe whose stage and error are
// RETURNED and shown in the UI - never a silent catch that fakes a
// status (TReps rule, PHASE1.md). Extraction itself is source-agnostic
// (engine/extract.ts) and every field is user-confirmed before saving.
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";
import type { RawField } from "../engine/extract.ts";

export interface OcrOutcome {
  stage: string;
  text: string;
  error: string | null;
  source: "mlkit" | "paste" | "none";
}

export async function pickImageUri(): Promise<{ uri: string | null; error: string | null }> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return { uri: null, error: "Photo library permission not granted." };
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.9 });
  if (result.canceled) return { uri: null, error: null };
  return { uri: result.assets[0]?.uri ?? null, error: null };
}

export async function takePhotoUri(): Promise<{ uri: string | null; error: string | null }> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return { uri: null, error: "Camera permission not granted." };
  const result = await ImagePicker.launchCameraAsync({ quality: 0.9 });
  if (result.canceled) return { uri: null, error: null };
  return { uri: result.assets[0]?.uri ?? null, error: null };
}

/** Pick ANY file (PDF, image, anything in Files) - owner QA round 6:
 * the image picker greys PDFs out, and tax documents ARE PDFs. */
export async function pickDocumentFile(): Promise<{ uri: string | null; name: string | null; mimeType: string | null; error: string | null }> {
  try {
    const result = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
    if (result.canceled) return { uri: null, name: null, mimeType: null, error: null };
    const a = result.assets[0];
    return { uri: a?.uri ?? null, name: a?.name ?? null, mimeType: a?.mimeType ?? null, error: null };
  } catch (e) {
    return { uri: null, name: null, mimeType: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function recognizeOnDevice(uri: string): Promise<OcrOutcome> {
  if (Platform.OS === "web") {
    return { stage: "web", text: "", error: "On-device OCR runs in the native app. On web, paste the statement text instead.", source: "none" };
  }
  try {
    // Capability probe: result AND error both surface to the caller/UI.
    const mod = require("@react-native-ml-kit/text-recognition");
    const TextRecognition = mod.default ?? mod;
    const result = await TextRecognition.recognize(uri);
    const text: string = result?.text ?? "";
    if (!text) return { stage: "mlkit", text: "", error: "ML Kit returned no text for this image.", source: "mlkit" };
    return { stage: "mlkit", text, error: null, source: "mlkit" };
  } catch (e) {
    return { stage: "mlkit-load", text: "", error: e instanceof Error ? e.message : String(e), source: "none" };
  }
}

export { textToRawFields } from "./textFields.ts";
