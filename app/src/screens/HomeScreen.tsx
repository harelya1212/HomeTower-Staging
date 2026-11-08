import React, { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { predictionConfidence } from "../../engine/confidence.ts";
import { householdFreshness, reminderCandidates } from "../../engine/freshness.ts";
import { annualFocus, documentRequests, nextAction, nextPhaseStart } from "../../engine/guidance.ts";
import { accuracyLevel } from "../../engine/intake.ts";
import { computeHouseholdTax } from "../../engine/snapshot.ts";
import { GREEN, RED, RefundGauge, RingGauge, YELLOW } from "../components/Gauge.tsx";
import { StateFlag } from "../components/StateFlag.tsx";
import { ageOn, educationLine, goalPct, projectValue } from "../goals.ts";
import { getPushStatus, isPushEnabled, syncStaleReminders, type PushStatus } from "../push.ts";
import { buildProfileExtras, todayIso, useHousehold } from "../store.tsx";

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
  // Derivations (owner QA round 2): when the My House tables exist they
  // win - retirement years come from the primary member's age and
  // planned retirement age, balances from the assets table. The Intake
  // goal fields stay as the fallback for households that skip My House.
  const selfMember = state.family.find((m) => m.role === "self") ?? state.family.find((m) => m.role === "spouse");
  const selfAge = selfMember ? ageOn(selfMember.dob, today) : null;
  const yearsToRetire = selfAge !== null && selfMember ? Math.max(0, (selfMember.retireAge || 67) - selfAge) : g.retirementYears;
  const retAssets = state.assets.filter((a) => a.kind === "401k" || a.kind === "ira");
  const eduAssets = state.assets.filter((a) => a.kind === "529");
  const retBalance = retAssets.length ? retAssets.reduce((s, a) => s + a.value, 0) : g.retirementBalance;
  const retMonthly = retAssets.length ? retAssets.reduce((s, a) => s + a.monthly, 0) : g.retirementMonthly;
  const eduBalance = eduAssets.length ? eduAssets.reduce((s, a) => s + a.value, 0) : g.eduBalance;
  const eduMonthly = eduAssets.length ? eduAssets.reduce((s, a) => s + a.monthly, 0) : g.eduMonthly;
  // Owner QA round 8: targets are per person / per child when set -
  // the rings use the sum of the personal targets; the single Intake
  // goal fields remain the fallback.
  const retireTargetSum = state.family
    .filter((m) => m.role === "self" || m.role === "spouse")
    .reduce((s, m) => s + (m.retireTarget || 0), 0);
  const eduTargetSum = state.family
    .filter((m) => m.role === "child")
    .reduce((s, m) => s + (m.eduTarget || 0), 0);
  const retirementPct = goalPct(projectValue(retBalance, retMonthly, yearsToRetire, g.assumedReturnPct), retireTargetSum > 0 ? retireTargetSum : g.retirementTarget);
  const eduPct = goalPct(projectValue(eduBalance, eduMonthly, g.eduYears, g.assumedReturnPct), eduTargetSum > 0 ? eduTargetSum : g.eduTarget);
  const children = state.family.filter((m) => m.role === "child");

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

  // SPEC45 sec. 39+42: exactly one NEXT ACTION, computed by the engine
  // guidance layer from the same numbers the dashboard shows.
  const month = Number(today.slice(5, 7));
  const phase = annualFocus(month);
  const nextPhase = nextPhaseStart(month);
  const requests = documentRequests(state.intake, buildProfileExtras(state), today);
  const labelOf = (docType: string) => requests.find((r) => r.docType === docType)?.label ?? docType;
  const payslipFinding = findings.find((f) => f.docType === "payslip");
  const fedPosition = fed < fedLow ? "below" : fed > fedHigh ? "above" : "inside";
  const action = nextAction({
    calibrationMissing: confidence.calibrationMissing,
    verificationDue:
      state.payrollCheck.consecutive >= 2 && !!payslipFinding && payslipFinding.status !== "fresh",
    staleDocs: findings.filter((f) => f.status === "stale").map((f) => labelOf(f.docType)),
    agingDocs: findings.filter((f) => f.status === "aging").map((f) => labelOf(f.docType)),
    missingRequestLabel: requests.find((r) => r.status === "missing")?.label ?? null,
    federalPosition: fedPosition as "below" | "inside" | "above",
    federalDelta: fedPosition === "below" ? fedLow - fed : fedPosition === "above" ? fed - fedHigh : 0,
    annualPhaseTitle: phase.title,
    confidenceBand: confidence.band,
    confidenceScore: confidence.score,
  });
  const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const confColor = confidence.band === "High" ? GREEN : confidence.band === "Moderate" ? YELLOW : RED;
  const ringColor = (pct: number | null) => (pct === null ? "#9DB2C3" : pct >= 80 ? GREEN : pct >= 50 ? YELLOW : RED);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.household}>{state.intake.name || "Your household"}</Text>
      <Text style={styles.subtitle}>Where do we stand? - {today}</Text>

      <View style={styles.actionCard}>
        <Text style={styles.actionLabel}>NEXT ACTION</Text>
        <Text style={styles.actionText}>{action.action}</Text>
        <Text style={styles.actionRow}><Text style={styles.actionKey}>Why: </Text>{action.why}</Text>
        <Text style={styles.actionRow}><Text style={styles.actionKey}>Expected benefit: </Text>{action.expectedBenefit}</Text>
        <Text style={styles.actionRow}><Text style={styles.actionKey}>Trade-off: </Text>{action.tradeOff}</Text>
        <Text style={styles.actionRow}><Text style={styles.actionKey}>Confidence: </Text>{action.confidence}</Text>
        <Text style={styles.actionRow}><Text style={styles.actionKey}>What could change this: </Text>{action.whatCouldChange}</Text>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Text style={styles.cardLabel}>🇺🇸 Federal refund projection</Text>
          <Text style={[styles.bigValue, { color: fed >= fedLow && fed <= fedHigh ? GREEN : fed < fedLow ? RED : YELLOW }]}>{money(fed)}</Text>
        </View>
        <RefundGauge value={fed} low={fedLow} high={fedHigh} />
      </View>

      <View style={styles.card}>
        <View style={styles.cardHead}>
          <View style={styles.labelRow}>
            <StateFlag state={state.intake.state} />
            <Text style={styles.cardLabel}>{state.intake.state} state refund projection</Text>
          </View>
          <Text style={[styles.bigValue, { color: st >= g.stateRefundTargetLow && st <= g.stateRefundTargetHigh ? GREEN : st < g.stateRefundTargetLow ? RED : YELLOW }]}>{money(st)}</Text>
        </View>
        <RefundGauge value={st} low={g.stateRefundTargetLow} high={g.stateRefundTargetHigh} />
      </View>

      <View style={styles.ringsRow}>
        <RingGauge pct={confidence.score} label={`Prediction confidence (${confidence.band})`} color={confColor} />
        <RingGauge pct={retirementPct ?? 0} label={retirementPct === null ? "Retirement - set a target" : `Retirement - ${yearsToRetire} yrs`} color={ringColor(retirementPct)} />
        <RingGauge pct={eduPct ?? 0} label={eduPct === null ? "Education - set a target" : `Education savings`} color={ringColor(eduPct)} />
      </View>
      {(retirementPct !== null || eduPct !== null) && (
        <Text style={styles.assumption}>Goal rings assume {g.assumedReturnPct}% yearly growth - an editable assumption in Intake, not a promise.</Text>
      )}

      {children.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Education timing</Text>
          {children.map((c) => (
            <Text key={c.id} style={styles.line}>🎓 {educationLine(c.name || "Child", c.dob, c.studentNow, c.collegeStartYear, c.yearsLeftInCollege, today)}</Text>
          ))}
        </View>
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

      <View style={styles.card}>
        <Text style={styles.cardLabel}>📅 {phase.title}</Text>
        <Text style={styles.line}>This phase of the annual planning cycle: {phase.items.join(" · ")}</Text>
        <Text style={styles.line}>Next: {nextPhase.title} (starts {MONTH_NAMES[nextPhase.month - 1]})</Text>
      </View>

      <Text style={styles.pushLine}>
        Push: {push && isPushEnabled(state.pushEnabled, push) ? `on, ${push.scheduledCount} reminder(s) scheduled` : state.pushEnabled ? "on in settings - token registers in the native app" : "off"}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F4F7FA" },
  content: { padding: 16, paddingBottom: 74, gap: 12 },
  pad: { padding: 16 },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 8 },
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
  actionCard: { backgroundColor: "#FFFFFF", borderRadius: 14, padding: 14, gap: 5, borderWidth: 2, borderColor: TEAL },
  actionLabel: { fontSize: 12.5, fontWeight: "800", color: TEAL, letterSpacing: 1 },
  actionText: { fontSize: 19, fontWeight: "800", color: NAVY, lineHeight: 25 },
  actionRow: { fontSize: 14.5, color: "#22303C", lineHeight: 21 },
  actionKey: { fontWeight: "700", color: NAVY },
  pushLine: { fontSize: 12, color: "#5A6B7C", textAlign: "center" },
});
