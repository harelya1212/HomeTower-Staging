// Document capture -> OCR text -> raw fields for the engine's extractor.
// Two text sources, one interface:
// - Native: ML Kit on-device text recognition from a picked photo.
// - Everywhere (incl. web): the user pastes text copied from a statement.
// The ML Kit load is a capability probe whose stage and error are
// RETURNED and shown in the UI - never a silent catch that fakes a
// status (TReps rule, PHASE1.md). Extraction itself is source-agnostic
// (engine/extract.ts) and every field is user-confirmed before saving.
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

/** Turn OCR/plain text into label-value pairs the extractor understands.
 * Handles "Label: value", "Label value" and label-line/value-line layouts. */
export function textToRawFields(text: string, confidence = 0.9): RawField[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const fields: RawField[] = [];
  const moneyish = /[$\d][\d,]*\.?\d*/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const colon = line.indexOf(":");
    if (colon > 0) {
      fields.push({ key: line.slice(0, colon), value: line.slice(colon + 1).trim(), confidence });
      continue;
    }
    const m = line.match(/^(.*?)(\$?\(?-?[\d][\d,]*\.?\d*\)?)$/);
    if (m && m[1].trim().length >= 2 && /[A-Za-z]/.test(m[1])) {
      fields.push({ key: m[1].trim(), value: m[2], confidence });
      continue;
    }
    if (!moneyish.test(line) && i + 1 < lines.length && moneyish.test(lines[i + 1])) {
      fields.push({ key: line, value: lines[i + 1], confidence });
      i++;
    }
  }
  return fields;
}
