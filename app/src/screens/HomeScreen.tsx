import React, { useEffect, useMemo, useState } from "react";
import { Image, ScrollView, StyleSheet, Text, View } from "react-native";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const LOGO_MARK = require("../../assets/logo-mark.png");
import { predictionConfidence } from "../../engine/confidence.ts";
import { householdFreshness, reminderCandidates } from "../../engine/freshness.ts";
import { accuracyLevel } from "../../engine/intake.ts";
import { computeHouseholdTax } from "../../engine/snapshot.ts";
import { getPushStatus, isPushEnabled, syncStaleReminders, type PushStatus } from "../push.ts";
import { todayIso, useHousehold } from "../store.tsx";

export const NAVY = "#0B2A4A";
export const TEAL = "#0E7C86";

export function money(x: number): string {
  const sign = x < 0 ? "-" : "";
  return `${sign}$${Math.abs(Math.round(x)).toLocaleString("en-US")}`;
}

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.chip, { backgroundColor: color }]}>
      <Text style={styles.chipText}>{label}</Text>
    </View>
  );
}

export default function HomeScreen() {
  const { state, loaded } = useHousehold();
  const [push, setPush] = useState<PushStatus | null>(null);

  const snap = useMemo(() => {
    try {
      return computeHouseholdTax(
        state.intake.filingStatus,
        state.grossIncome,
        state.federalWithholdingYtd,
        state.stateWithholdingYtd,
        state.ltcgIncome,
      );
    } catch {
      return null;
    }
  }, [state]);

  const today = todayIso();
  const findings = useMemo(() => householdFreshness(state.intake.documents, today), [state.intake.documents, today]);
  const candidates = useMemo(() => reminderCandidates(state.intake.documents, today), [state.intake.documents, today]);
  const level = accuracyLevel(state.intake);
  const confidence = useMemo(() => predictionConfidence(state.intake, today), [state.intake, today]);
  const bandColor = confidence.band === "High" ? "#1E8E3E" : confidence.band === "Moderate" ? "#E37400" : "#C5221F";

  useEffect(() => {
    getPushStatus().then(setPush);
  }, []);
  useEffect(() => {
    if (loaded) syncStaleReminders(candidates, state.pushEnabled).then(() => getPushStatus().then(setPush));
  }, [loaded, candidates.length, state.pushEnabled]);

  if (!loaded) return <View style={styles.screen}><Text>Loading...</Text></View>;
  if (!snap) return <View style={styles.screen}><Text>Snapshot is available for Arizona in Phase 1.</Text></View>;

  const refund = snap.federalRefundOwe;
  const low = state.intake.refundTargetLow ?? 0;
  const high = state.intake.refundTargetHigh ?? 0;
  const inBand = refund >= low && refund <= high;
  const targetColor = inBand ? "#1E8E3E" : refund < low ? "#C5221F" : "#E37400";
  const targetLabel = inBand ? "GREEN - on target" : refund < low ? "RED - below target" : "YELLOW - over-withheld";

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.brandRow}>
        <Image source={LOGO_MARK} style={styles.logo} resizeMode="contain" />
        <Text style={styles.brand}>HomeTower</Text>
      </View>
      <Text style={styles.title}>{state.intake.name || "Your household"}</Text>
      <Text style={styles.subtitle}>Where do we stand? - {today}</Text>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Projected federal {refund >= 0 ? "refund" : "amount owed"}</Text>
        <Text style={styles.bigNumber}>{money(refund)}</Text>
        <Text style={styles.line}>Your target: {money(low)} - {money(high)}</Text>
        <Chip label={targetLabel} color={targetColor} />
      </View>

      <View style={styles.card}>
        <Text style={styles.line}>Federal tax: {money(snap.federalTax)}</Text>
        <Text style={styles.line}>Arizona tax: {money(snap.stateTax)}</Text>
        <Text style={styles.line}>Total tax (incl. NIIT {money(snap.niit)}): {money(snap.totalTax)}</Text>
        <Text style={styles.line}>Marginal rate: {(snap.marginalRate * 100).toFixed(0)}% - next bracket in {money(snap.distanceToNextBracket)}</Text>
        <Text style={styles.line}>Accuracy level: {level} (derived from your documents)</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Prediction confidence</Text>
        <View style={styles.confRow}>
          <Text style={[styles.confScore, { color: bandColor }]}>{confidence.score}</Text>
          <Chip label={confidence.band} color={bandColor} />
        </View>
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${confidence.score}%`, backgroundColor: bandColor }]} />
        </View>
        <Text style={styles.line}>Completeness {Math.round(confidence.completeness)}/35 - Freshness {Math.round(confidence.freshness)}/25 - Extraction {Math.round(confidence.extraction)}/10 - Coverage {Math.round(confidence.coverage)}/10 - Calibration {Math.round(confidence.calibration)}/20</Text>
        {confidence.reasons.map((r) => (
          <Text key={r} style={styles.line}>- {r}</Text>
        ))}
        <Text style={styles.note}>The score falls when documents age or stay missing, so a projection never looks fresher than its data.</Text>
      </View>

      {candidates.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Documents needing attention</Text>
          {candidates.map((c) => (
            <Text key={c.docType} style={styles.line}>{c.status === "stale" ? "🔴" : "🟡"} {c.message}</Text>
          ))}
        </View>
      )}
      {findings.length > 0 && candidates.length === 0 && (
        <View style={styles.card}><Text style={styles.line}>🟢 All documents are fresh.</Text></View>
      )}

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Push reminders</Text>
        <Text style={styles.line}>
          {push && isPushEnabled(state.pushEnabled, push)
            ? `On - token stored, ${push.scheduledCount} reminder(s) scheduled.`
            : state.pushEnabled
              ? "Setting is ON (default). Register from the Intake tab to store a push token - status counts only with a token."
              : "Off in settings."}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F4F7FA" },
  content: { padding: 16, gap: 12 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  logo: { width: 44, height: 44, borderRadius: 10 },
  brand: { fontSize: 26, fontWeight: "800", color: NAVY },
  title: { fontSize: 24, fontWeight: "700", color: NAVY },
  subtitle: { fontSize: 14, color: "#5A6B7C", marginBottom: 4 },
  card: { backgroundColor: "#FFFFFF", borderRadius: 12, padding: 16, gap: 6 },
  cardLabel: { fontSize: 13, fontWeight: "600", color: TEAL, textTransform: "uppercase" },
  bigNumber: { fontSize: 36, fontWeight: "800", color: NAVY },
  line: { fontSize: 15, color: "#22303C" },
  chip: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginTop: 4 },
  chipText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
  confRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  confScore: { fontSize: 40, fontWeight: "800" },
  barTrack: { height: 10, borderRadius: 999, backgroundColor: "#E3EAF1", overflow: "hidden" },
  barFill: { height: 10, borderRadius: 999 },
  note: { fontSize: 12, color: "#5A6B7C" },
});
