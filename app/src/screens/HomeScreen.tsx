import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { predictionConfidence } from "../../engine/confidence.ts";
import { householdFreshness, reminderCandidates } from "../../engine/freshness.ts";
import { annualFocus, documentRequests, nextAction, nextPhaseStart } from "../../engine/guidance.ts";
import { accuracyLevel } from "../../engine/intake.ts";
import { computeHouseholdTax } from "../../engine/snapshot.ts";
import { GREEN, RED, RefundGauge, RingGauge, YELLOW } from "../components/Gauge.tsx";
import { StateFlag } from "../components/StateFlag.tsx";
import { ageOn, earliestAgeReaching, educationFunding, educationLine, projectValue, requiredMonthly, retirementNeedEstimate } from "../goals.ts";
import { isoToUs } from "../components/Fields.tsx";
import { getPushStatus, isPushEnabled, syncStaleReminders, type PushStatus } from "../push.ts";
import { composeCloseReport, deriveHoldings, type CloseReport } from "../market.ts";
import { payslipForecast } from "../payslips.ts";
import { fetchQuotes, type QuotesOutcome } from "../quotes";
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

  const today = todayIso();
  // Payslip-driven forecast (owner QA, 2026-11-08): when saved
  // payslips project the year per earner (YTD anchor + remaining
  // periods at the current run rate), THOSE figures drive the tax
  // snapshot - projected W-2 taxable wages as income, projected
  // withholding as withholding. The typed Intake numbers are the
  // fallback for households without usable payslips, and the source
  // line under the gauges says which one is live.
  const slipFc = useMemo(
    () => payslipForecast(state.intake.documents, state.family, state.jobs, today),
    [state.intake.documents, state.family, state.jobs, today],
  );
  const effIncome = slipFc ? slipFc.projectedTaxable : state.grossIncome;
  const effFederalWh = slipFc ? slipFc.projectedFederal : state.federalWithholdingYtd;
  const effStateWh = slipFc ? slipFc.projectedState : state.stateWithholdingYtd;

  const snap = useMemo(() => {
    try {
      return computeHouseholdTax(state.intake.filingStatus, effIncome, effFederalWh, effStateWh, state.ltcgIncome);
    } catch {
      return null;
    }
  }, [state, effIncome, effFederalWh, effStateWh]);

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
  const children = state.family.filter((m) => m.role === "child");
  const hasIncome = effIncome > 0;

  // Retirement outlook per adult (owner QA round 18): not a ring - an
  // answer. Can this person retire at the age they chose, at today's
  // pace? If not, at what age does the money work, or what monthly
  // contribution makes the chosen age work?
  const adults = state.family.filter((m) => m.role === "self" || m.role === "spouse");
  const householdNeed = retirementNeedEstimate(effIncome);
  const adultOutlook = adults.map((m) => {
    const age = ageOn(m.dob, today);
    const owned = state.assets.filter((a) => (a.kind === "401k" || a.kind === "ira") && m.name.trim() !== "" && a.ownerName.trim().toLowerCase() === m.name.trim().toLowerCase());
    const bal = owned.length ? owned.reduce((s, a) => s + a.value, 0) : m.role === "self" ? retBalance : 0;
    const mo = owned.length ? owned.reduce((s, a) => s + a.monthly, 0) : m.role === "self" ? retMonthly : 0;
    const need = m.retireTarget > 0 ? m.retireTarget : householdNeed > 0 ? Math.round(householdNeed / Math.max(1, adults.length)) : 0;
    if (age === null) return { m, age, bal, mo, need, years: 0, projected: 0, onTrack: false, realisticAge: null as number | null, reqMo: 0 };
    const years = Math.max(0, (m.retireAge || 67) - age);
    const projected = projectValue(bal, mo, years, g.assumedReturnPct);
    const onTrack = need > 0 && projected >= need;
    const realisticAge = need > 0 && !onTrack ? earliestAgeReaching(bal, mo, need, g.assumedReturnPct, age, m.retireAge || 67) : null;
    const reqMo = need > 0 && years > 0 ? Math.round(requiredMonthly(bal, need, years, g.assumedReturnPct)) : 0;
    return { m, age, bal, mo, need, years, projected, onTrack, realisticAge, reqMo };
  });

  // Education funding per child (owner QA round 18, SPEC45 sec. 32):
  // saved vs the real cost path - per child, with their own dates.
  const thisYear = Number(today.slice(0, 4));
  const eduOutlook = children.map((c) => {
    const age = ageOn(c.dob, today);
    let yearsToStart = 0;
    if (!c.studentNow && c.collegeStartYear > 0) yearsToStart = Math.max(0, c.collegeStartYear - thisYear);
    else if (!c.studentNow && age !== null) yearsToStart = Math.max(0, 18 - age);
    const duration = c.studentNow && c.yearsLeftInCollege > 0 ? c.yearsLeftInCollege : c.eduDurationYears || 4;
    const funding = educationFunding(c.eduBalance || 0, c.eduMonthly || 0, yearsToStart, duration, c.eduAnnualCost || 0, c.eduScholarshipYear || 0, g.assumedReturnPct);
    return { c, yearsToStart, duration, funding };
  });
  const retireScored = adultOutlook.filter((a) => a.need > 0 && a.age !== null);
  const retireTile = retireScored.length === 0 ? "Not scored yet" : retireScored.every((a) => a.onTrack) ? "On track" : (() => { const ages = retireScored.filter((a) => !a.onTrack).map((a) => a.realisticAge); return ages.some((x) => x === null) ? "Not by 80" : `Ready at ${Math.max(...(ages as number[]))}`; })();
  const eduScored = eduOutlook.filter((e) => e.funding.pctFunded !== null);
  const eduGapTotal = eduScored.reduce((s, e) => s + e.funding.gap, 0);
  const eduTile = eduScored.length === 0 ? "Set a cost" : eduGapTotal <= 0 ? "Covered" : `${money(eduGapTotal)} gap`;
  const LEVEL_WORDS: Record<string, string> = { "X": "rough estimate", "X+": "planning grade", "X++": "decision grade", "X+++": "filing grade" };

  useEffect(() => {
    getPushStatus().then(setPush);
  }, []);
  const holdingsInfo = useMemo(() => deriveHoldings(state.intake.documents), [state.intake.documents]);
  const [closeOutcome, setCloseOutcome] = useState<QuotesOutcome | null>(null);
  const [closeReport, setCloseReport] = useState<CloseReport | null>(null);
  const [closeBusy, setCloseBusy] = useState(false);
  const loadClose = async () => {
    if (holdingsInfo.positions.length === 0) return;
    setCloseBusy(true);
    const outcome = await fetchQuotes(holdingsInfo.positions.map((p) => p.ticker));
    setCloseOutcome(outcome);
    setCloseReport(Object.keys(outcome.quotes).length > 0 ? composeCloseReport(holdingsInfo.positions, holdingsInfo.cash, outcome.quotes) : null);
    setCloseBusy(false);
  };
  useEffect(() => {
    if (loaded && holdingsInfo.positions.length > 0) void loadClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, holdingsInfo.positions.length]);
  useEffect(() => {
    if (loaded) syncStaleReminders(candidates, state.pushEnabled, holdingsInfo.positions.length > 0).then(() => getPushStatus().then(setPush));
  }, [loaded, candidates.length, state.pushEnabled, holdingsInfo.positions.length]);

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
      <Text style={styles.subtitle}>Where do we stand? - {isoToUs(today)}</Text>

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
          {hasIncome && <Text style={[styles.bigValue, { color: fed >= fedLow && fed <= fedHigh ? GREEN : fed < fedLow ? RED : YELLOW }]}>{money(fed)}</Text>}
        </View>
        {hasIncome ? (
          <RefundGauge value={fed} low={fedLow} high={fedHigh} />
        ) : (
          <Text style={styles.line}>No income added yet - this is not a $0 refund, it is a blank. Upload a payslip in Documents and HomeTower projects your refund against your {money(fedLow)} - {money(fedHigh)} target.</Text>
        )}
      </View>

      <View style={styles.card}>
        <View style={styles.cardHead}>
          <View style={styles.labelRow}>
            <StateFlag state={state.intake.state} />
            <Text style={styles.cardLabel}>{state.intake.state} state refund projection</Text>
          </View>
          {hasIncome && <Text style={[styles.bigValue, { color: st >= g.stateRefundTargetLow && st <= g.stateRefundTargetHigh ? GREEN : st < g.stateRefundTargetLow ? RED : YELLOW }]}>{money(st)}</Text>}
        </View>
        {hasIncome ? (
          <RefundGauge value={st} low={g.stateRefundTargetLow} high={g.stateRefundTargetHigh} />
        ) : (
          <Text style={styles.line}>Same story on the state side: no income yet, so no projection. Your state target stays {money(g.stateRefundTargetLow)} - {money(g.stateRefundTargetHigh)}.</Text>
        )}
      </View>

      {slipFc && (
        <Text style={styles.assumption}>
          Forecast from your payslips: {slipFc.earners.map((e) => `${e.name.split(" ")[0]} through ${isoToUs(e.anchorEnd)}, + ${e.periodsRemaining} pay periods at the current rate`).join(" · ")}. Projected W-2 wages {money(slipFc.projectedTaxable)} for the year; the withholding in the gauges is projected to year-end, not yet paid. Remove the payslips and the typed Intake numbers take over again.
        </Text>
      )}

      <View style={styles.ringsRow}>
        <RingGauge pct={confidence.score} label={`Prediction confidence (${confidence.band})`} color={confColor} />
        <View style={styles.goalTiles}>
          <View style={styles.goalTile}>
            <Text style={styles.dualValue}>{retireTile}</Text>
            <Text style={styles.statLabel}>Retirement at the ages you picked</Text>
          </View>
          <View style={styles.goalTile}>
            <Text style={styles.dualValue}>{eduTile}</Text>
            <Text style={styles.statLabel}>College funding, all children</Text>
          </View>
        </View>
      </View>
      <Text style={styles.assumption}>Outlooks below assume {g.assumedReturnPct}% yearly growth - an editable assumption in Intake, not a promise.</Text>

      {adults.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Retirement outlook - per person</Text>
          {adultOutlook.map(({ m, age, need, years, projected, onTrack, realisticAge, reqMo, mo }) => (
            <View key={m.id} style={styles.personBlock}>
              <Text style={styles.personName}>{m.name || (m.role === "self" ? "You" : "Spouse")} - retire at {m.retireAge || 67}</Text>
              {age === null ? (
                <Text style={styles.line}>Add a date of birth in the {state.intake.name || "My House"} tab and HomeTower can time this.</Text>
              ) : need <= 0 ? (
                <Text style={styles.line}>Age {age}, {years} years to go. Add household income (or a personal target in the {state.intake.name || "My House"} tab) so HomeTower can estimate how much is enough.</Text>
              ) : onTrack ? (
                <Text style={styles.line}>🟢 On track: projected {money(projected)} by age {m.retireAge || 67} against about {money(need)} needed.</Text>
              ) : (
                <Text style={styles.line}>🔴 Not yet: projected {money(projected)} by age {m.retireAge || 67} against about {money(need)} needed. {realisticAge !== null ? `At today's pace the money is ready at ${realisticAge}.` : "At today's pace it is not ready even by 80."} Or save {money(reqMo)}/mo instead of {money(mo)}/mo to retire at {m.retireAge || 67}.</Text>
              )}
            </View>
          ))}
        </View>
      )}

      {children.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Education - timing and funding, per child</Text>
          {eduOutlook.map(({ c, yearsToStart, duration, funding }) => (
            <View key={c.id} style={styles.personBlock}>
              <Text style={styles.line}>🎓 {educationLine(c.name || "Child", c.dob, c.studentNow, c.collegeStartYear, c.yearsLeftInCollege, today)}</Text>
              {funding.pctFunded === null ? (
                <Text style={styles.line}>Set the expected cost per year for {c.name || "this child"} in the {state.intake.name || "My House"} tab (in-state or out-of-state, with or without room & board) and HomeTower shows whether the savings cover it.</Text>
              ) : (
                <>
                  <Text style={styles.line}>{funding.gap <= 0 ? "🟢" : funding.pctFunded >= 70 ? "🟡" : "🔴"} {duration} years at {money(c.eduAnnualCost || 0)}/yr{c.eduScholarshipYear ? ` minus ${money(c.eduScholarshipYear)}/yr scholarship` : ""} ({c.eduInState ? "in-state" : "out-of-state"}{c.eduRoomBoard ? ", with room & board" : ", no room & board"}): needs about {money(funding.needAtStart)} by the start{yearsToStart > 0 ? ` (${yearsToStart} yrs away)` : ""}.</Text>
                  <Text style={styles.line}>Saved {money(c.eduBalance || 0)} + {money(c.eduMonthly || 0)}/mo projects to {money(funding.projectedAtStart)} - {funding.pctFunded}% funded{funding.gap > 0 ? `, a ${money(funding.gap)} gap` : ""}.</Text>
                  {funding.gap > 0 && yearsToStart > 0 && <Text style={styles.line}>To close it: save {money(funding.requiredMonthly)}/mo instead of {money(c.eduMonthly || 0)}/mo.</Text>}
                  {funding.gap > 0 && yearsToStart === 0 && <Text style={styles.line}>College is here - the gap has to come from cash flow, loans, or a cheaper plan.</Text>}
                </>
              )}
            </View>
          ))}
        </View>
      )}

      {!hasIncome ? (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Your tax picture - waiting for income</Text>
          <Text style={styles.line}>Once income is in, four numbers appear here in plain words: your top tax rate, how much room is left in that bracket, your projected total tax, and how solid these numbers are. Right now there is no income, so HomeTower shows nothing rather than a meaningless bracket.</Text>
        </View>
      ) : (
        <View style={styles.statsRow}>
          <View style={styles.stat}><Text style={styles.statValue}>{(snap.marginalRate * 100).toFixed(0)}%</Text><Text style={styles.statLabel}>Your top tax rate - each extra $1 of income is taxed at this rate</Text></View>
          <View style={styles.stat}><Text style={styles.statValue}>{money(snap.distanceToNextBracket)}</Text><Text style={styles.statLabel}>Room left in this bracket before the rate goes up</Text></View>
          <View style={styles.stat}><Text style={styles.statValue}>{money(snap.totalTax)}</Text><Text style={styles.statLabel}>Projected federal tax for the year</Text></View>
          <View style={styles.stat}><Text style={styles.statValue}>{level}</Text><Text style={styles.statLabel}>How solid these numbers are: {LEVEL_WORDS[level] ?? level}</Text></View>
        </View>
      )}

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

      {holdingsInfo.positions.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>📈 Market close{closeOutcome?.asOf ? ` - ${isoToUs(closeOutcome.asOf)}` : ""}</Text>
          {closeBusy && <Text style={styles.line}>Loading closing prices...</Text>}
          {!closeBusy && closeOutcome?.notConnected && (
            <Text style={styles.line}>Live prices load through the HomeTower sender, which is not connected yet - and in the native app. Your holdings basis for the report: {holdingsInfo.positions.map((p) => `${p.ticker} x${p.quantity}`).join(", ")}{holdingsInfo.cash !== null ? `, cash $${holdingsInfo.cash.toLocaleString("en-US")}` : ""} (as last entered{holdingsInfo.basisDate ? ` ${isoToUs(holdingsInfo.basisDate)}` : ""}).</Text>
          )}
          {!closeBusy && closeOutcome?.error && <Text style={styles.line}>{closeOutcome.error}</Text>}
          {!closeBusy && closeReport && (
            <>
              {closeReport.lines.map((l) => (
                <Text key={l.ticker} style={styles.line}>{l.alert ? "⚠️ " : ""}{l.ticker}: ${l.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, {l.changePct >= 0 ? "+" : "-"}{Math.abs(l.changePct).toFixed(2)}%</Text>
              ))}
              <Text style={styles.line}>Estimated today: {closeReport.gainUsd >= 0 ? "+" : "-"}${Math.abs(Math.round(closeReport.gainUsd)).toLocaleString("en-US")} on your holdings{closeReport.pctHoldings !== null ? ` (${closeReport.pctHoldings >= 0 ? "+" : "-" }${Math.abs(closeReport.pctHoldings).toFixed(1)}%)` : ""}{closeReport.pctWithCash !== null ? `, ${closeReport.pctWithCash >= 0 ? "+" : "-"}${Math.abs(closeReport.pctWithCash).toFixed(1)}% including cash` : ""}. Quantities as last entered{holdingsInfo.basisDate ? ` ${isoToUs(holdingsInfo.basisDate)}` : ""}; prices: Yahoo Finance{closeOutcome?.asOf ? `, close of ${isoToUs(closeOutcome.asOf)}` : ""}.</Text>
              {closeReport.missing.length > 0 && <Text style={styles.line}>No price loaded for: {closeReport.missing.join(", ")} - excluded from the totals, not estimated.</Text>}
            </>
          )}
          <Pressable onPress={() => void loadClose()}>
            <Text style={styles.manualLink}>Refresh closing prices</Text>
          </Pressable>
        </View>
      )}

      <Text style={styles.pushLine}>
        Push: {push && isPushEnabled(state.pushEnabled, push) ? `on, ${push.scheduledCount} reminder(s) scheduled` : state.pushEnabled ? "on (Intake tab) - token registers in the native app" : "off - turn it on in the Intake tab"}
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
  ringsRow: { flexDirection: "row", justifyContent: "space-between", backgroundColor: "#FFFFFF", borderRadius: 14, paddingVertical: 12, paddingHorizontal: 6, gap: 8 },
  goalTiles: { flex: 1, gap: 8, justifyContent: "center" },
  goalTile: { backgroundColor: "#F4F7FA", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 8, alignItems: "center" },
  dualValue: { fontSize: 17, fontWeight: "800", color: NAVY, textAlign: "center" },
  personBlock: { gap: 2, paddingTop: 6 },
  personName: { fontSize: 15, fontWeight: "800", color: NAVY },
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
  manualLink: { color: "#0f766e", fontSize: 15, fontWeight: "700", marginTop: 4 },
});
