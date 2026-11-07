import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { predictionConfidence } from "../../engine/confidence.ts";
import { extractFields, type ExtractionResult } from "../../engine/extract.ts";
import { householdFreshness } from "../../engine/freshness.ts";
import { DOCUMENT_TYPES, type DocumentRecord } from "../../engine/intake.ts";
import { pickImageUri, recognizeOnDevice, textToRawFields } from "../ocr.ts";
import AdSlot from "../components/AdSlot.tsx";
import { todayIso, useHousehold } from "../store.tsx";
import { NAVY, TEAL } from "./HomeScreen.tsx";

const BADGE: Record<string, string> = { fresh: "#1E8E3E", aging: "#E37400", stale: "#C5221F", unknown: "#5A6B7C" };

export default function DocumentsScreen() {
  const { state, updateIntake } = useHousehold();
  const docs = state.intake.documents;
  const today = todayIso();
  const findings = useMemo(() => householdFreshness(docs, today), [docs, today]);
  const byKey = useMemo(
    () => new Map(docs.map((d, i) => [i, findings.find((f) => f.docType === d.docType)])),
    [docs, findings],
  );
  const indicators = useMemo(() => predictionConfidence(state.intake, today).perDocument, [state.intake, today]);
  const countsLabel = (c: string) => (c === "fully" ? "● counts fully" : c === "partially" ? "◐ counts partially" : "○ counts barely");
  const countsColor = (c: string) => (c === "fully" ? "#1E8E3E" : c === "partially" ? "#E37400" : "#C5221F");
  const [selectedType, setSelectedType] = useState("payslip");
  const [pasteText, setPasteText] = useState("");
  const [ocrNote, setOcrNote] = useState<string | null>(null);
  const [extraction, setExtraction] = useState<ExtractionResult | null>(null);

  const runExtraction = (text: string) => {
    try {
      const raw = textToRawFields(text);
      if (!raw.length) {
        setOcrNote("No label-value pairs found in that text. Check the text and try again.");
        setExtraction(null);
        return;
      }
      setExtraction(extractFields(raw, selectedType));
      setOcrNote(null);
    } catch (e) {
      setOcrNote(e instanceof Error ? e.message : String(e));
      setExtraction(null);
    }
  };

  const scanPhoto = async () => {
    setOcrNote(null);
    const { uri, error } = await pickImageUri();
    if (error) { setOcrNote(error); return; }
    if (!uri) return;
    const outcome = await recognizeOnDevice(uri);
    if (outcome.error) { setOcrNote(`OCR stage ${outcome.stage}: ${outcome.error}`); return; }
    runExtraction(outcome.text);
  };

  const confirmExtraction = () => {
    if (!extraction) return;
    const record: DocumentRecord = {
      docType: selectedType,
      status: extraction.status,
      confidence: extraction.confidence,
      capturedOn: today,
    };
    updateIntake({ documents: [...docs, record] });
    setExtraction(null);
    setPasteText("");
    setOcrNote(`Saved ${selectedType} (${extraction.status}, confidence ${extraction.confidence}).`);
  };

  const addManual = () => {
    updateIntake({ documents: [...docs, { docType: selectedType, status: "parsed", confidence: 1, capturedOn: today }] });
  };
  const removeDoc = (index: number) => updateIntake({ documents: docs.filter((_, i) => i !== index) });

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Documents</Text>
      <Text style={styles.note}>
        The register of what the household has provided. Capture a document below: the text is read on this device,
        fields are extracted, and you confirm before anything is saved. Freshness is computed per document type.
      </Text>

      {docs.length === 0 && <Text style={styles.line}>No documents yet. Capture the first one below.</Text>}
      {docs.map((d, i) => {
        const f = byKey.get(i);
        return (
          <View key={i} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.docType}>{d.docType}</Text>
              <Text style={styles.line}>Captured: {d.capturedOn ?? "unknown"} - status: {d.status}</Text>
              {f && <Text style={[styles.line, { color: BADGE[f.status] }]}>{f.status.toUpperCase()} - {f.message}</Text>}
              {indicators[i] && <Text style={[styles.line, { color: countsColor(indicators[i].counts), fontWeight: "600" }]}>{countsLabel(indicators[i].counts)} toward prediction confidence</Text>}
            </View>
            <Pressable onPress={() => removeDoc(i)}>
              <Text style={styles.remove}>Remove</Text>
            </Pressable>
          </View>
        );
      })}

      <Text style={styles.section}>Capture a document</Text>
      <View style={styles.chips}>
        {[...DOCUMENT_TYPES].map((t) => (
          <Pressable key={t} style={[styles.chip, selectedType === t && styles.chipSelected]} onPress={() => setSelectedType(t)}>
            <Text style={selectedType === t ? styles.chipTextSelected : styles.chipText}>{t}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable style={styles.button} onPress={scanPhoto}>
        <Text style={styles.buttonText}>Scan a photo of the {selectedType}</Text>
      </Pressable>
      <TextInput
        style={styles.pasteBox}
        multiline
        placeholder="...or paste the document text here (works on every platform)"
        value={pasteText}
        onChangeText={setPasteText}
      />
      <Pressable style={styles.buttonAlt} onPress={() => runExtraction(pasteText)}>
        <Text style={styles.buttonText}>Extract fields from pasted text</Text>
      </Pressable>
      {ocrNote && <Text style={styles.note}>{ocrNote}</Text>}

      {extraction && (
        <View style={styles.confirmCard}>
          <Text style={styles.section}>Confirm extracted fields</Text>
          <Text style={styles.line}>Confidence: {extraction.confidence} - status if saved: {extraction.status}</Text>
          {Object.entries(extraction.fields).map(([k, v]) => (
            <Text key={k} style={styles.line}>{k}: {String(v)}</Text>
          ))}
          {Object.keys(extraction.fields).length === 0 && (
            <Text style={styles.line}>No known fields matched this document type. You can still save it as a register entry.</Text>
          )}
          <Pressable style={styles.button} onPress={confirmExtraction}>
            <Text style={styles.buttonText}>Confirm and save document</Text>
          </Pressable>
          <Pressable onPress={() => setExtraction(null)}>
            <Text style={styles.remove}>Discard</Text>
          </Pressable>
        </View>
      )}

      <Pressable onPress={addManual}>
        <Text style={styles.manualLink}>No text handy? Register {selectedType} manually (today, no extraction)</Text>
      </Pressable>
      <AdSlot />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F4F7FA" },
  content: { padding: 16, gap: 10 },
  title: { fontSize: 22, fontWeight: "700", color: NAVY },
  note: { fontSize: 13, color: "#5A6B7C" },
  section: { fontSize: 16, fontWeight: "700", color: NAVY, marginTop: 10 },
  line: { fontSize: 13, color: "#22303C" },
  row: { backgroundColor: "#FFFFFF", borderRadius: 8, padding: 12, flexDirection: "row", gap: 8, alignItems: "flex-start" },
  docType: { fontSize: 15, fontWeight: "700", color: NAVY },
  remove: { color: "#C5221F", fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: TEAL, paddingHorizontal: 10, paddingVertical: 5 },
  chipSelected: { backgroundColor: TEAL },
  chipText: { color: TEAL, fontSize: 12, fontWeight: "600" },
  chipTextSelected: { color: "#FFFFFF", fontSize: 12, fontWeight: "600" },
  button: { backgroundColor: TEAL, borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  buttonAlt: { backgroundColor: NAVY, borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  buttonText: { color: "#FFFFFF", fontWeight: "700" },
  pasteBox: { backgroundColor: "#FFFFFF", borderRadius: 8, padding: 12, minHeight: 90, textAlignVertical: "top", fontSize: 13 },
  confirmCard: { backgroundColor: "#FFFFFF", borderRadius: 12, padding: 14, gap: 6, borderWidth: 1, borderColor: TEAL },
  manualLink: { color: TEAL, fontSize: 13, fontWeight: "600", marginTop: 6 },
});
