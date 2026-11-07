import React, { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { predictionConfidence } from "../../engine/confidence.ts";
import { householdFreshness, reminderCandidates } from "../../engine/freshness.ts";
import { accuracyLevel } from "../../engine/intake.ts";
import { computeHouseholdTax } from "../../engine/snapshot.ts";
import AdSlot from "../components/AdSlot.tsx";
import { GREEN, RED, RefundGauge, RingGauge, YELLOW } from "../components/Gauge.tsx";
import { goalPct, projectValue } from "../goals.ts";
import { getPushStatus, isPushEnabled, syncStaleReminders, type PushStatus } from "../push.ts";
import { todayIso, useHousehold } from "../store.tsx";

export const NAVY = "#0B2A4A";
export const TEAL = "#0E7C86";

export function money(x: number): string {
  const sign = x < 0 ? "-" : "";
  return `${sign}$${Math.abs(Math.round(x)).toLocaleString("en-US")}`;
}

export default function HomeScreen() {
  const { state, loaded } = useHousehold();
  const [push, setPush] = useState<PushStatus | null>(null);

  const snap = useMemo(() => {
    try {
      return computeHouseholdTax(state.intake.filingStatus, state.grossIncome, state.federalWithholdingYtd, state.stateWithholdingYtd, state.ltcgIncome);
    } catch {
      return null;
    }
  }, [state]);

  const today = todayIso();
  const findings = useMemo(() => householdFreshness(state.intake.documents, today), [state.intake.documents, today]);
  const candidates = useMemo(() => reminderCandidates(state.intake.documents, today), [state.intake.documents, today]);
  const confidence = useMemo(() => predictionConfidence(state.intake, today), [state.intake, today]);
  const level = accuracyLevel(state.intake);

  const g = state.goals;
  const retirementPct = goalPct(projectValue(g.retirementBalance, g.retirementMonthly, g.retirementYears, g.assumedReturnPct), g.retirementTarget);
  const eduPct = goalPct(projectValue(g.eduBalance, g.eduMonthly, g.eduYears, g.assumedReturnPct), g.eduTarget);

  useEffect(() => {
    getPushStatus().then(setPush);
  }, []);
  useEffect(() => {
    if (loaded) syncStaleReminders(candidates, state.pushEnabled).then(() => getPushStatus().then(setPush));
  }, [loaded, candidates.length, state.pushEnabled]);

  if (!loaded) return <View style={styles.screen}><Text style={styles.pad}>Loading...</Text></View>;
  if (!snap) return <View style={styles.screen}><Text style={styles.pad}>Snapshot is available for Arizona in Phase 1.</Text></View>;

  const fed = snap.federalRefundOwe;
  const st = snap.stateRefundOwe;
  const fedLow = state.intake.refundTargetLow ?? 0;
  const fedHigh = state.intake.refundTargetHigh ?? 0;
  const confColor = confidence.band === "High" ? GREEN : confidence.band === "Moderate" ? YELLOW : RED;
  const ringColor = (pct: number | null) => (pct === null ? "#9DB2C3" : pct >= 80 ? GREEN : pct >= 50 ? YELLOW : RED);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.household}>{state.intake.name || "Your household"}</Text>
      <Text style={styles.subtitle}>Where do we stand? - {today}</Text>

      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Text style={styles.cardLabel}>🇺🇸 Federal refund projection</Text>
          <Text style={[styles.bigValue, { color: fed >= fedLow && fed <= fedHigh ? GREEN : fed < fedLow ? RED : YELLOW }]}>{money(fed)}</Text>
        </View>
        <RefundGauge value={fed} low={fedLow} high={fedHigh} />
      </View>

      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Text style={styles.cardLabel}>🌵 {state.intake.state} state refund projection</Text>
          <Text style={[styles.bigValue, { color: st >= g.stateRefundTargetLow && st <= g.stateRefundTargetHigh ? GREEN : st < g.stateRefundTargetLow ? RED : YELLOW }]}>{money(st)}</Text>
        </View>
        <RefundGauge value={st} low={g.stateRefundTargetLow} high={g.stateRefundTargetHigh} />
      </View>

      <View style={styles.ringsRow}>
        <RingGauge pct={confidence.score} label={`Prediction confidence (${confidence.band})`} color={confColor} />
        <RingGauge pct={retirementPct ?? 0} label={retirementPct === null ? "Retirement - set a target" : `Retirement - ${g.retirementYears} yrs`} color={ringColor(retirementPct)} />
        <RingGauge pct={eduPct ?? 0} label={eduPct === null ? "Education - set a target" : `Education savings`} color={ringColor(eduPct)} />
      </View>
      {(retirementPct !== null || eduPct !== null) && (
        <Text style={styles.assumption}>Goal rings assume {g.assumedReturnPct}% yearly growth - an editable assumption in Intake, not a promise.</Text>
      )}

      <View style={styles.statsRow}>
        <View style={styles.stat}><Text style={styles.statValue}>{(snap.marginalRate * 100).toFixed(0)}%</Text><Text style={styles.statLabel}>Marginal rate</Text></View>
        <View style={styles.stat}><Text style={styles.statValue}>{money(snap.distanceToNextBracket)}</Text><Text style={styles.statLabel}>To next bracket</Text></View>
        <View style={styles.stat}><Text style={styles.statValue}>{money(snap.totalTax)}</Text><Text style={styles.statLabel}>Total tax</Text></View>
        <View style={styles.stat}><Text style={styles.statValue}>{level}</Text><Text style={styles.statLabel}>Accuracy level</Text></View>
      </View>

      {(candidates.length > 0 || confidence.calibrationMissing) && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Needs attention</Text>
          {candidates.map((c) => (
            <Text key={c.docType} style={styles.line}>{c.status === "stale" ? "🔴" : "🟡"} {c.message}</Text>
          ))}
          {confidence.calibrationMissing && <Text style={styles.line}>🟡 Last year's filed return is not verified yet - it calibrates every projection (Intake tab).</Text>}
          {findings.length > 0 && candidates.length === 0 && <Text style={styles.line}>🟢 All documents are fresh.</Text>}
        </View>
      )}

      <Text style={styles.pushLine}>
        Push: {push && isPushEnabled(state.pushEnabled, push) ? `on, ${push.scheduledCount} reminder(s) scheduled` : state.pushEnabled ? "on in settings - token registers in the native app" : "off"}
      </Text>

      <AdSlot />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F4F7FA" },
  content: { padding: 16, gap: 12 },
  pad: { padding: 16 },
  household: { fontSize: 22, fontWeight: "800", color: NAVY },
  subtitle: { fontSize: 13, color: "#5A6B7C" },
  card: { backgroundColor: "#FFFFFF", borderRadius: 14, padding: 14, gap: 4 },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardLabel: { fontSize: 14, fontWeight: "700", color: NAVY },
  bigValue: { fontSize: 26, fontWeight: "800" },
  ringsRow: { flexDirection: "row", justifyContent: "space-between", backgroundColor: "#FFFFFF", borderRadius: 14, paddingVertical: 12, paddingHorizontal: 6 },
  assumption: { fontSize: 11, color: "#5A6B7C", textAlign: "center" },
  statsRow: { flexDirection: "row", gap: 8 },
  stat: { flex: 1, backgroundColor: "#FFFFFF", borderRadius: 12, paddingVertical: 10, alignItems: "center" },
  statValue: { fontSize: 16, fontWeight: "800", color: NAVY },
  statLabel: { fontSize: 10, color: "#5A6B7C", textAlign: "center" },
  line: { fontSize: 14, color: "#22303C" },
  pushLine: { fontSize: 12, color: "#5A6B7C", textAlign: "center" },
});
