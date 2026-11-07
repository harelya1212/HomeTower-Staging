import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { householdFreshness } from "../../engine/freshness.ts";
import { DOCUMENT_TYPES, type DocumentRecord } from "../../engine/intake.ts";
import { todayIso, useHousehold } from "../store.tsx";
import { NAVY, TEAL } from "./HomeScreen.tsx";

const BADGE: Record<string, string> = { fresh: "#1E8E3E", aging: "#E37400", stale: "#C5221F", unknown: "#5A6B7C" };

export default function DocumentsScreen() {
  const { state, updateIntake } = useHousehold();
  const docs = state.intake.documents;
  const today = todayIso();
  const findings = useMemo(() => householdFreshness(docs, today), [docs, today]);
  const byType = useMemo(() => new Map(findings.map((f) => [f.docType + "|" + (docs.find((d) => d.docType === f.docType)?.capturedOn ?? ""), f])), [findings, docs]);
  const [selectedType, setSelectedType] = useState("payslip");

  const addDoc = () => {
    const record: DocumentRecord = { docType: selectedType, status: "parsed", confidence: 1, capturedOn: today };
    updateIntake({ documents: [...docs, record] });
  };
  const removeDoc = (index: number) => updateIntake({ documents: docs.filter((_, i) => i !== index) });

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Documents</Text>
      <Text style={styles.note}>
        The register of what the household has provided. Freshness is computed per document type; stale documents flag here and by push.
        Camera and on-device OCR capture arrive in the next step - for now, register documents manually.
      </Text>

      {docs.length === 0 && <Text style={styles.line}>No documents yet. Add the first one below.</Text>}
      {docs.map((d, i) => {
        const f = byType.get(d.docType + "|" + (d.capturedOn ?? ""));
        return (
          <View key={i} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.docType}>{d.docType}</Text>
              <Text style={styles.line}>Captured: {d.capturedOn ?? "unknown"} - status: {d.status}</Text>
              {f && <Text style={[styles.line, { color: BADGE[f.status] }]}>{f.status.toUpperCase()} - {f.message}</Text>}
            </View>
            <Pressable onPress={() => removeDoc(i)}>
              <Text style={styles.remove}>Remove</Text>
            </Pressable>
          </View>
        );
      })}

      <Text style={styles.section}>Add a document</Text>
      <View style={styles.chips}>
        {[...DOCUMENT_TYPES].map((t) => (
          <Pressable key={t} style={[styles.chip, selectedType === t && styles.chipSelected]} onPress={() => setSelectedType(t)}>
            <Text style={selectedType === t ? styles.chipTextSelected : styles.chipText}>{t}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable style={styles.button} onPress={addDoc}>
        <Text style={styles.buttonText}>Add {selectedType} (today)</Text>
      </Pressable>
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
  buttonText: { color: "#FFFFFF", fontWeight: "700" },
});
