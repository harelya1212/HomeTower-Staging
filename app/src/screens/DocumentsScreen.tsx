import { useNavigation } from "@react-navigation/native";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { predictionConfidence } from "../../engine/confidence.ts";
import { extractFields, type ExtractionResult } from "../../engine/extract.ts";
import { householdFreshness } from "../../engine/freshness.ts";
import { DOCUMENT_TYPES, type DocumentRecord } from "../../engine/intake.ts";
import { documentRequests, payrollShortcut } from "../../engine/guidance.ts";
import { pickImageUri, recognizeOnDevice, takePhotoUri, textToRawFields } from "../ocr.ts";
import { buildProfileExtras, todayIso, useHousehold } from "../store.tsx";
import { NAVY, TEAL } from "./HomeScreen.tsx";

const BADGE: Record<string, string> = { fresh: "#1E8E3E", aging: "#E37400", stale: "#C5221F", unknown: "#5A6B7C" };

export default function DocumentsScreen() {
  const { state, update, updateIntake } = useHousehold();
  const navigation = useNavigation<any>();
  const scrollRef = useRef<ScrollView>(null);
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
  const [extractionType, setExtractionType] = useState("payslip");
  const [expandedReq, setExpandedReq] = useState<string | null>(null);
  const requests = useMemo(
    () => documentRequests(state.intake, buildProfileExtras(state), today),
    [state.intake, state.assets, state.family, today],
  );
  const reqBadge = (s: string) =>
    s === "satisfied" ? { t: "✓ Have it", c: "#1E8E3E" } : s === "stale" ? { t: "Stale - update", c: "#C5221F" } : { t: "Missing", c: "#E37400" };
  const hasPayslip = docs.some((d) => d.docType === "payslip" && d.status === "parsed");
  const [payAnswers, setPayAnswers] = useState({ gross: "no", net: "no", benefits: "no" });
  const [payNote, setPayNote] = useState<string | null>(null);

  const confirmPayrollCycle = () => {
    const r = payrollShortcut(payAnswers.gross, payAnswers.net, payAnswers.benefits, state.payrollCheck.consecutive);
    if (r.provisional) update({ payrollCheck: { lastConfirmedOn: today, consecutive: r.consecutiveAfter } });
    setPayNote(r.reason);
  };

  const runExtraction = (text: string, docType: string = selectedType) => {
    try {
      const raw = textToRawFields(text);
      if (!raw.length) {
        setOcrNote("No label-value pairs found in that text. Check the text and try again.");
        setExtraction(null);
        return;
      }
      setExtraction(extractFields(raw, docType));
      setExtractionType(docType);
      setOcrNote(null);
    } catch (e) {
      setOcrNote(e instanceof Error ? e.message : String(e));
      setExtraction(null);
    }
  };

  const scanPhoto = async (source: "upload" | "camera", docType: string = selectedType) => {
    setOcrNote(null);
    const { uri, error } = source === "camera" ? await takePhotoUri() : await pickImageUri();
    if (error) { setOcrNote(error); return; }
    if (!uri) return;
    const outcome = await recognizeOnDevice(uri);
    if (outcome.error) { setOcrNote(`OCR stage ${outcome.stage}: ${outcome.error}`); return; }
    runExtraction(outcome.text, docType);
  };

  useEffect(() => {
    if (extraction) {
      const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
      return () => clearTimeout(t);
    }
  }, [extraction]);

  const confirmExtraction = () => {
    if (!extraction) return;
    const record: DocumentRecord = {
      docType: extractionType,
      status: extraction.status,
      confidence: extraction.confidence,
      capturedOn: today,
      fields: Object.fromEntries(Object.entries(extraction.fields).map(([k, v]) => [k, String(v)])),
    };
    updateIntake({ documents: [...docs, record] });
    if (extractionType === "payslip") update({ payrollCheck: { lastConfirmedOn: null, consecutive: 0 } });
    setExtraction(null);
    setPasteText("");
    setOcrNote(`Saved ${extractionType} (${extraction.status}, confidence ${extraction.confidence}).`);
  };

  const addManual = () => {
    updateIntake({ documents: [...docs, { docType: selectedType, status: "parsed", confidence: 1, capturedOn: today }] });
    if (selectedType === "payslip") update({ payrollCheck: { lastConfirmedOn: null, consecutive: 0 } });
  };
  const removeDoc = (index: number) => updateIntake({ documents: docs.filter((_, i) => i !== index) });

  return (
    <ScrollView ref={scrollRef} style={styles.screen} contentContainerStyle={styles.content}>
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

      <Text style={styles.section}>What your household needs</Text>
      <Text style={styles.note}>
        Your profile decides this list - the app never asks every household for every document (SPEC45, Smart Document Request Engine).
        Tap an item to upload it right there.
      </Text>
      {requests.map((r) => {
        const b = reqBadge(r.status);
        const open = expandedReq === r.key;
        return (
          <View key={r.key} style={styles.reqCard}>
            <Pressable
              style={styles.reqRow}
              onPress={() => { setSelectedType(r.docType); setExpandedReq(open ? null : r.key); }}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.docType}>{r.label}</Text>
                <Text style={styles.line}>{r.detail}</Text>
              </View>
              <Text style={{ color: b.c, fontWeight: "700", fontSize: 14 }}>{b.t}</Text>
            </Pressable>
            {open && r.key === "calibration_outcome" && (
              <View style={styles.reqActions}>
                <Text style={styles.line}>This one is not a document - it is the number the IRS and the state actually confirmed. Record it once in the Intake tab and the confidence score uses it as the calibration anchor.</Text>
                <Pressable style={styles.button} onPress={() => navigation.navigate("Intake")}>
                  <Text style={styles.buttonText}>Open Intake to record the outcome</Text>
                </Pressable>
              </View>
            )}
            {open && r.key !== "calibration_outcome" && (
              <View style={styles.reqActions}>
                <Pressable style={styles.button} onPress={() => scanPhoto("upload", r.docType)}>
                  <Text style={styles.buttonText}>Upload a photo or file of this document</Text>
                </Pressable>
                <Pressable style={styles.buttonAlt} onPress={() => scanPhoto("camera", r.docType)}>
                  <Text style={styles.buttonText}>Take a photo of this document</Text>
                </Pressable>
              </View>
            )}
          </View>
        );
      })}

      {hasPayslip && (
        <View style={styles.confirmCard}>
          <Text style={styles.section}>Payroll check - the intelligent shortcut</Text>
          <Text style={styles.line}>
            Instead of uploading a new payslip every cycle: did anything change since the last one?
          </Text>
          {state.payrollCheck.lastConfirmedOn && (
            <Text style={styles.line}>
              Last confirmed unchanged: {state.payrollCheck.lastConfirmedOn} (provisional cycle {state.payrollCheck.consecutive} of 3 - the 3rd needs the document)
            </Text>
          )}
          {([
            ["gross", "Did gross pay change?"],
            ["net", "Did the net deposit change?"],
            ["benefits", "Did any benefit election change?"],
          ] as const).map(([key, label]) => (
            <View key={key}>
              <Text style={styles.line}>{label}</Text>
              <View style={styles.chips}>
                {([["no", "No change"], ["yes", "Changed"], ["unsure", "Not sure"]] as const).map(([val, lab]) => (
                  <Pressable
                    key={val}
                    style={[styles.chip, payAnswers[key] === val && styles.chipSelected]}
                    onPress={() => setPayAnswers((a) => ({ ...a, [key]: val }))}
                  >
                    <Text style={payAnswers[key] === val ? styles.chipTextSelected : styles.chipText}>{lab}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
          <Pressable style={styles.button} onPress={confirmPayrollCycle}>
            <Text style={styles.buttonText}>Confirm this cycle</Text>
          </Pressable>
          {payNote && <Text style={styles.note}>{payNote}</Text>}
        </View>
      )}

      <Text style={styles.section}>Capture a document</Text>
      <View style={styles.chips}>
        {[...DOCUMENT_TYPES].map((t) => (
          <Pressable key={t} style={[styles.chip, selectedType === t && styles.chipSelected]} onPress={() => setSelectedType(t)}>
            <Text style={selectedType === t ? styles.chipTextSelected : styles.chipText}>{t}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable style={styles.button} onPress={() => scanPhoto("upload")}>
        <Text style={styles.buttonText}>Upload a photo or file of the {selectedType}</Text>
      </Pressable>
      <Pressable style={styles.buttonAlt} onPress={() => scanPhoto("camera")}>
        <Text style={styles.buttonText}>Take a photo of the {selectedType}</Text>
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F4F7FA" },
  content: { padding: 16, paddingBottom: 74, gap: 10 },
  title: { fontSize: 25, fontWeight: "800", color: NAVY },
  note: { fontSize: 14.5, color: "#5A6B7C", lineHeight: 21 },
  section: { fontSize: 19, fontWeight: "800", color: NAVY, marginTop: 10 },
  line: { fontSize: 15.5, color: "#22303C", lineHeight: 22 },
  row: { backgroundColor: "#FFFFFF", borderRadius: 8, padding: 12, flexDirection: "row", gap: 8, alignItems: "flex-start" },
  reqCard: { backgroundColor: "#FFFFFF", borderRadius: 8, padding: 12, gap: 10 },
  reqRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  reqActions: { gap: 8 },
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
