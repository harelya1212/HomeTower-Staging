// Backup & restore (data-loss fix, 2026-11-07).
//
// HomeTower is local-first: the household lives ONLY in this browser /
// web app's storage on this device. Deleting the home-screen app on
// iOS deletes that storage with it - the owner lost his entered data
// exactly that way, following our own advice to re-add the icon after
// a broken build. The protection is a user-owned backup FILE:
// download it any time; restore from it on any device or browser.
// Nothing is uploaded anywhere - the file is the user's, like every
// other document in this app.
import { readAsStringAsync } from "expo-file-system/legacy";
import { Platform } from "react-native";
import { pickFile } from "./filePick";
import type { HouseholdState } from "./store.tsx";

/** Trigger a backup-file download (web). Returns an error message or null. */
export function downloadBackup(json: string, filename: string): string | null {
  if (Platform.OS !== "web") {
    return "Backup download runs in the web app for now; the phone app gets its own in the native build.";
  }
  try {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

async function readPickedText(picked: { file?: File; uri?: string }): Promise<string> {
  if (picked.file) return await picked.file.text();
  if (Platform.OS === "web" && picked.uri) {
    return await (await fetch(picked.uri)).text();
  }
  return await readAsStringAsync(picked.uri as string);
}

/** Pick a file and, if it is a HomeTower backup, hand it to `restore`.
 * Returns a status message for the UI, or null when the user cancelled. */
export async function pickAndRestore(restore: (parsed: Partial<HouseholdState>) => void): Promise<string | null> {
  const picked = await pickFile();
  if (picked.error) return picked.error;
  if (picked.cancelled || (!picked.uri && !picked.file)) {
    return "No file reached HomeTower - the picker closed without a selection arriving. Nothing was changed.";
  }
  try {
    const text = await readPickedText(picked);
    const parsed = JSON.parse(text) as Partial<HouseholdState>;
    if (!parsed || typeof parsed !== "object" || !("intake" in parsed) || !("family" in parsed)) {
      return "That file is not a HomeTower backup - nothing was changed.";
    }
    restore(parsed);
    return "Backup restored - your household is back.";
  } catch {
    return "That file could not be read as a HomeTower backup - nothing was changed.";
  }
}
