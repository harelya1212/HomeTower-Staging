import React, { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { predictionConfidence } from "../../engine/confidence.ts";
import { householdFreshness, reminderCandidates } from "../../engine/freshness.ts";
import { annualFocus, documentRequests, nextAction, nextPhaseStart } from "../../engine/guidance.ts";
import { computeHouseholdTax } from "../../engine/snapshot.ts";
import { computeFederalTax } from "../../engine/federal.ts";
import { stateTaxModelInfo } from "../../engine/state.ts";
import { domainAccuracy } from "../domainAccuracy.ts";
import { GREEN, RED, RefundGauge, RingGauge, YELLOW } from "../components/Gauge.tsx";
import { StateFlag } from "../components/StateFlag.tsx";
import { ageOn, educationLine, educationOutlookFor, faceStatusFor } from "../goals.ts";
import RetirementDetails from "../components/RetirementDetails.tsx";
import RetirementTimeline from "../components/RetirementTimeline.tsx";
import { computeRetirementModel } from "../retirementModel.ts";
import { reconciliationTasks } from "../reconcile.ts";
import { isoToUs } from "../components/Fields.tsx";
import { getPushStatus, isPushEnabled, syncStaleReminders, type PushStatus } from "../push.ts";
import { composeCloseReport, deriveHoldings, type CloseReport } from "../market.ts";
import { payslip401kTotals, payslipForecast, payslipGaps } from "../payslips.ts";
import { fetchQuotes, type QuotesOutcome } from "../quotes";
import { buildProfileExtras, setRetirementIntent, setWizardIntent, todayIso, useHousehold } from "../store.tsx";

export const NAVY = "#0B2A4A";
export const TEAL = "#0E7C86";

export function money(x: number): string {
  const sign = x < 0 ? "-" : "";
  return `${sign}$${Math.abs(Math.round(x)).toLocaleString("en-US")}`;
}

/** Compact money for indicator tiles ($3.92M, $107K, $950): tile
 * values must never truncate - RN Web ignores adjustsFontSizeToFit,
 * which is how "$3,918,6..." shipped in round 41. */
export function moneyShort(x: number): string {
  const a = Math.abs(x);
  if (a >= 1_000_000) return `$${(x / 1_000_000).toFixed(2)}M`;
  if (a >= 10_000) return `$${Math.round(x / 1_000)}K`;
  return money(x);
}

/** Default annual college cost when the household has not set one
 * (owner QA, 2026-11-08: an unset cost must not leave a child
 * unscored). Roughly the published average for an in-state public
 * four-year year including room & board - always labelled on screen
 * as a default, and replaced the moment a real figure is set. */
export const DEFAULT_EDU_ANNUAL_COST = 24000;

export default function HomeScreen() {
  const { state, loaded } = useHousehold();
  const navigation = useNavigation<any>();
  const [push, setPush] = useState<PushStatus | null>(null);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [showCalc, setShowCalc] = useState(false);
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [showRetDetails, setShowRetDetails] = useState(false);

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
  const gaps = useMemo(
    () => (slipFc ? [] : payslipGaps(state.intake.documents, today)),
    [slipFc, state.intake.documents, today],
  );
  const k401Totals = useMemo(
    () => payslip401kTotals(state.intake.documents, today, state.jobs),
    [state.intake.documents, today, state.jobs],
  );
  const effIncome = slipFc ? slipFc.projectedTaxable : state.grossIncome;
  const effFederalWh = slipFc ? slipFc.projectedFederal : state.federalWithholdingYtd;
  const effStateWh = slipFc ? slipFc.projectedState : state.stateWithholdingYtd;

  const snap = useMemo(() => {
    try {
      // Engine round 45: with payslips, the snapshot also runs the
      // Additional Medicare reconciliation on the forecast's
      // per-earner Medicare wages and Medicare withholding.
      return computeHouseholdTax(state.intake.filingStatus, effIncome, effFederalWh, effStateWh, state.ltcgIncome, null, 0, 0, "AZ",
        slipFc ? slipFc.earners.map((e) => e.projectedMedicareWages) : null,
        slipFc ? slipFc.earners.map((e) => e.projectedMedicareWithheld) : null);
    } catch {
      return null;
    }
  }, [state, effIncome, effFederalWh, effStateWh, slipFc]);

  const findings = useMemo(() => householdFreshness(state.intake.documents, today), [state.intake.documents, today]);
  const candidates = useMemo(() => reminderCandidates(state.intake.documents, today), [state.intake.documents, today]);
  const confidence = useMemo(() => predictionConfidence(state.intake, today), [state.intake, today]);

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

  // Retirement outlook per adult (owner QA round 18) and the whole
  // household retirement model: computed by retirementModel.ts
  // (round 52 extraction) so the Home card and the Retirement
  // screen render ONE model - the numbers can never drift.
  const retModel = computeRetirementModel({ state, today, slipFc, k401Totals, retBalance, retMonthly, effIncome, moneyFmt: money });
  const {
    adults, adultOutlook, spendingAnnual, spendingTier, spendingKnown, spendingSet,
    ssAnnualTotal, pensionAnnualEff, projectedToday, laterYear, hhRet, readinessPct,
    hhShort, hhReqMo, accuracy, accuracyLine, coveredByDependable, retHeadline,
    personalizeSentence, directional,
  } = retModel;
  // Round 52: at accuracy X with enough evidence for a path, the
  // card face is the directional outlook (spec section 8) - still
  // no target figure and no readiness % at X (round 48 law holds);
  // at X with no path to draw, the round-48 face stays.
  const useDirectionalFace = accuracy.level === "X" && directional !== null && directional.sufficient;
  // Round 53: the X face is a visual status card - one status line,
  // two big numbers, the timeline, one opportunity line, one action.
  // The face status softens an off-track rating to "Too early to
  // confirm" at X only (faceStatusFor); precise prescriptions never
  // appear at X (round 53 item 4) - the levers live in the details.
  const retDisplay = useDirectionalFace && directional ? faceStatusFor(accuracy.level, directional.rating, directional.desiredAge) : null;
  const STATUS_DOT: Record<string, string> = { green: "\u{1F7E2}", yellow: "\u{1F7E1}", orange: "\u{1F7E0}", red: "\u{1F534}" };

  // Education funding per child (owner QA round 18, SPEC45 sec. 32):
  // saved vs the real cost path - per child, with their own dates.
  // ROUND 59 (TRACE F): the model (and its accuracy gating - a
  // child on default costs is early-estimate, never a red verdict)
  // is built by goals.educationOutlookFor so it is pinned in the
  // suite; this screen only renders it.
  const eduOutlook = educationOutlookFor(children, today, g.assumedReturnPct, DEFAULT_EDU_ANNUAL_COST)
    .map((e) => ({ ...e, c: e.child }));

  // ROUND 60 (P1-C): per-domain accuracy. Each forecast area
  // carries its own level from its own evidence; the global
  // prediction confidence below is a data-completeness indicator
  // and no longer governs these displays (it used to scale both
  // tax gauges' ranges). The state domain is capped by the state
  // model's honesty (P1-A).
  const domains = domainAccuracy({
    intake: state.intake,
    retirementLevel: accuracy.level,
    eduChildren: eduOutlook.map((e) => ({ onDefaultCost: e.usingDefaultCost })),
    hsaReconExplained: null, // the HSA verdict lives on the Documents HSA card, which computes it there
  });
  const azModel = stateTaxModelInfo(state.intake.state || "");
  const stateModelLabel = azModel.fullReturnModeled ? null : azModel.label;

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
  // Confidence reasons arrive with raw docType tokens - say them
  // the way the Documents page does.
  const DOC_LABEL: Record<string, string> = { payslip: "Payslip", prior_return: "Last year's filed return", w2: "W-2", "401k_statement": "401(k) statement", hsa_statement: "HSA statement", "529_statement": "529 statement", brokerage_statement: "Brokerage statement", pension_statement: "Pension statement", bank_statement: "Bank statement", card_statement: "Card statement", ssa_statement: "Social Security statement", other: "Document" };
  const prettyReason = (r: string) => {
    const [first, ...rest] = r.split(" ");
    return DOC_LABEL[first] ? [DOC_LABEL[first], ...rest].join(" ") : r;
  };
  const payslipFinding = findings.find((f) => f.docType === "payslip");
  const fedPosition = fed < fedLow ? "below" : fed > fedHigh ? "above" : "inside";
  // Which half of calibration is actually missing (item b, owner QA
  // 2026-11-08): the return can be on file while only its outcome is
  // missing - the action must ask for the missing half only.
  const cal = state.intake.calibration;
  const returnOnFile = state.intake.documents.some((d) => d.docType === "prior_return" && d.status === "parsed");
  const calibrationStage: "both" | "outcome" | "verify" =
    cal?.actualFederalRefundOwe != null && !cal?.outcomeVerified ? "verify"
    : returnOnFile || cal?.actualFederalRefundOwe != null ? "outcome"
    : "both";
  const action = nextAction({
    calibrationMissing: confidence.calibrationMissing,
    calibrationStage,
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

  // Round 44 (external design review + reconciliation, 2026-11-08):
  // every gauge carries its own next-action line and an expected
  // range, the two gauges get a combined position card, and the tax
  // picture shows its full calculation. (Round 60, P1-C: the range
  // is scaled by each gauge's OWN domain accuracy now - see
  // rangeFor - not by the global completeness score.)
  const fedDetail = useMemo(() => {
    try { return computeFederalTax(effIncome, state.intake.filingStatus, state.ltcgIncome); } catch { return null; }
  }, [effIncome, state.intake.filingStatus, state.ltcgIncome]);
  const periodsLeft = slipFc ? Math.max(...slipFc.earners.map((e) => e.periodsRemaining)) : null;
  const thisYr = Number(today.slice(0, 4));
  const perPeriod = (amount: number) => (periodsLeft && periodsLeft > 0 ? Math.max(5, Math.round(amount / periodsLeft / 5) * 5) : null);
  const gaugeAction = (value: number, low: number, high: number, side: "federal" | "state"): string => {
    const wh = side === "federal" ? "withholding" : `${state.intake.state} withholding`;
    if (value < 0) {
      const per = perPeriod(-value);
      return per ? `Worth acting on: about ${money(per)} more ${wh} per remaining pay period closes this gap.` : `Worth acting on: raise ${wh} now - every remaining pay period counts.`;
    }
    if (value < low) {
      const gap = low - value;
      if (gap <= 250) return "No action recommended - close enough to your target given the remaining uncertainty.";
      const per = perPeriod(gap);
      return per ? `Worth acting on: about ${money(per)} more ${wh} per remaining pay period lands you in the target.` : "Worth acting on: a small withholding increase lands you in the target.";
    }
    if (value > high) {
      const excess = value - high;
      return side === "federal"
        ? `No change needed for the rest of ${thisYr} - too few pay periods remain. For January ${thisYr + 1}: about ${money(excess)} less withholding across the year lands in the target.`
        : `No late-year change recommended. Recalibrate ${wh} for January ${thisYr + 1} - about ${money(excess)} less across the year lands in the target.`;
    }
    return "No action recommended - you are inside your target.";
  };
  // ROUND 60 (P1-C): a gauge's expected range is scaled by ITS
  // OWN domain accuracy now - the global completeness score used
  // to widen and narrow both gauges together, whatever each
  // forecast's own evidence looked like.
  const rangeFor = (value: number, level: "X" | "X+" | "X++"): string => {
    const factor = level === "X++" ? 0.19 : level === "X+" ? 0.32 : 0.5;
    const half = Math.max(150, Math.abs(value) * factor);
    return `Expected range: ${money(value - half)} - ${money(value + half)}`;
  };
  const combined = fed + st;
  const sidePhrase = (v: number) => (v < 0 ? `owe ${money(-v)}` : `${money(v)} refund`);
  const combinedHeadline = (fed < 0) !== (st < 0)
    ? combined >= 0 ? `Net refund ${money(combined)}` : `Net amount owed ${money(-combined)}`
    : combined >= 0 ? `Total projected refunds ${money(combined)}` : `Total projected owed ${money(-combined)}`;
  const combinedVerdict = (() => {
    const fedName = "Federal";
    const stName = state.intake.state;
    if (fed >= 0 && st >= 0) {
      const total = fed + st;
      const domSide = fed >= st ? fedName : stName;
      const domVal = Math.max(fed, st);
      const domAbove = domSide === fedName ? fed > fedHigh : st > g.stateRefundTargetHigh;
      if (total > 0 && domVal / total > 0.65 && domAbove) return `Household position: healthy overall - but ${domSide} is carrying too much of the refund.`;
      const belowSide = fed < fedLow ? fedName : st < g.stateRefundTargetLow ? stName : null;
      if (belowSide) return `Household position: healthy overall - the remaining gap sits with ${belowSide}.`;
      const aboveSide = fed > fedHigh ? fedName : st > g.stateRefundTargetHigh ? stName : null;
      if (aboveSide) return `Household position: healthy overall - ${aboveSide} is running above its target.`;
      return "Household position: healthy - both refunds sit inside their targets.";
    }
    if (fed < 0 && st < 0) return `Household position: ${money(-combined)} owed across both - withholding needs attention on both sides.`;
    const oweSide = fed < 0 ? fedName : stName;
    const refundSide = fed < 0 ? stName : fedName;
    return combined >= 0
      ? `Household position: the ${refundSide} refund covers the ${oweSide} bill, with ${money(combined)} left over.`
      : `Household position: the ${refundSide} refund does not cover the ${oweSide} bill - ${money(-combined)} still owed overall.`;
  })();
  // Additional Medicare is IN the engine since round 45 - liability,
  // withholding credit and net all come from the snapshot; nothing
  // is estimated in this screen anymore.
  // Provenance checklist for the confidence card: what the forecast
  // is actually based on, with dates, and what is still to come.
  const provenance: string[] = [];
  if (slipFc) for (const e of slipFc.earners) provenance.push(`✓ Payslips: ${e.name.split(" ")[0]} through ${isoToUs(e.anchorEnd)}`);
  else if (payslipFinding) provenance.push(`Payslips: ${payslipFinding.status} - add the latest in Documents`);
  if (k401Totals) provenance.push(`✓ 401(k) contributions from payslips: ${money(k401Totals.total)} in ${k401Totals.year}`);
  if (holdingsInfo.positions.length > 0) provenance.push(`✓ Brokerage holdings${holdingsInfo.basisDate ? ` as of ${isoToUs(holdingsInfo.basisDate)}` : ""}`);
  provenance.push(returnOnFile ? "✓ Last year's filed return: on file" : "• Last year's filed return: not added yet");
  provenance.push(cal?.actualFederalRefundOwe != null ? "✓ Last year's actual outcome: recorded" : "• Last year's actual outcome: not recorded yet");
  provenance.push("• Still to come: final W-2 and 1099 forms (January-February)");

  // Tasks (owner QA, 2026-11-08, items a/9/10): the Home page is
  // indicators; everything that asks the user to DO something lives
  // on one Tasks page behind a compact strip. The next action keeps
  // its full reasoning there - it no longer walls off the top of
  // Home. The old "Needs attention" and annual-phase cards are
  // folded in here, not repeated on Home.
  const verificationDue = state.payrollCheck.consecutive >= 2 && !!payslipFinding && payslipFinding.status !== "fresh";
  const actionTarget: string | null =
    verificationDue ? "Documents"
    : confidence.calibrationMissing ? "Intake"
    : findings.some((f) => f.status === "stale") ? "Documents"
    : fedPosition !== "inside" ? "Intake"
    : requests.some((r) => r.status === "missing") ? "Documents"
    : findings.some((f) => f.status === "aging") ? "Documents"
    : null;
  interface HomeTask { key: string; icon: string; title: string; detail?: string; target: string | null }
  const tasks: HomeTask[] = [{ key: "next", icon: "⭐", title: action.action, detail: action.why, target: actionTarget }];
  if (confidence.calibrationMissing && actionTarget !== "Intake") {
    tasks.push({ key: "calibration", icon: "🎯", title: calibrationStage === "verify" ? "Verify last year's actual outcome" : calibrationStage === "outcome" ? "Add last year's actual outcome" : "Add last year's filed return and its actual outcome", detail: "Calibration is the anchor of the whole forecast.", target: "Intake" });
  }
  const topStaleType = findings.find((f) => f.status === "stale")?.docType;
  for (const c of candidates) {
    if (actionTarget === "Documents" && action.action.startsWith("Update the ") && c.docType === topStaleType) continue; // already the next action
    tasks.push({ key: `fresh-${c.docType}`, icon: c.status === "stale" ? "🔴" : "🟡", title: c.message, target: "Documents" });
  }
  for (const gp of gaps) {
    tasks.push({ key: `gap-${gp.name}`, icon: "🧾", title: `${gp.name}: a payslip reading is missing ${gp.missing.join(" and ")}`, detail: "One regular slip per earner completes the forecast - a Workday PDF always contains both figures.", target: "Documents" });
  }
  if (adults.length > 0 && accuracy.level !== "X++" && accuracy.missing.length > 0) {
    tasks.push({ key: "ret-personalize", icon: "\u{1F3AF}", title: "Personalize your retirement forecast", detail: `Still missing: ${accuracy.missing.join(", ")}. Adding them moves the retirement card from ${accuracy.label.toLowerCase()} toward a high-confidence forecast.`, target: accuracy.missing.some((mm) => mm.includes("spending")) ? "Lifestyle" : "MyHouse" });
  }
  for (const r of requests) {
    if (r.status !== "missing" || r.key === "prior_return" || r.key === "calibration_outcome" || r.key === "payslip") continue;
    tasks.push({ key: `req-${r.key}`, icon: "📄", title: `Add the ${r.label.charAt(0).toLowerCase()}${r.label.slice(1)}`, detail: r.detail, target: "Documents" });
  }
  // Round 55 (workstreams C and D): distribution reconciliations
  // are derived from the saved documents - one task per child per
  // tax year for 529 distributions, one per year for HSA receipts,
  // by construction (re-uploads cannot duplicate them).
  for (const t of reconciliationTasks(
    state.intake.documents ?? [],
    state.family.filter((m) => m.role === "child").map((m) => ({ id: m.id, name: m.name })),
    state.hsaReceiptsMatched ?? {},
    state.eduVerifiedExpenses ?? {},
  )) {
    tasks.push({ key: t.key, icon: t.icon, title: t.title, detail: t.detail, target: t.target });
  }
  const allClear = tasks.length === 1 && actionTarget === null;

  return (
    <>
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.household}>{state.intake.name || "Your household"}</Text>
      <Text style={styles.subtitle}>Where do we stand? - {isoToUs(today)}</Text>

      <Pressable style={styles.taskStrip} onPress={() => setTasksOpen(true)}>
        <Text style={styles.taskStripIcon}>{allClear ? "✓" : "📋"}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.taskStripTitle}>{allClear ? "All caught up" : `${tasks.length} task${tasks.length === 1 ? "" : "s"} open`}</Text>
          <Text style={styles.taskStripNext} numberOfLines={1}>{allClear ? `This month: ${phase.title}` : `Next: ${action.action}`}</Text>
        </View>
        <Text style={styles.taskStripGo}>View ›</Text>
      </Pressable>

      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Text style={styles.cardLabel}>🇺🇸 Federal projection</Text>
          {hasIncome && <Text adjustsFontSizeToFit numberOfLines={1} style={[styles.bigValue, { color: fed < 0 ? RED : fed >= fedLow && fed <= fedHigh ? GREEN : YELLOW }]}>{fed < 0 ? `You owe ${money(-fed)}` : `Refund ${money(fed)}`}</Text>}
        </View>
        {hasIncome ? (
          <>
            <RefundGauge value={fed} low={fedLow} high={fedHigh} />
            <Text style={styles.line}>{fed < 0 ? `At this pace you owe the IRS ${money(-fed)} - your target is a ${money(fedLow)} - ${money(fedHigh)} refund.` : fed < fedLow ? `A refund is coming - ${money(fedLow - fed)} below your ${money(fedLow)} - ${money(fedHigh)} target.` : fed > fedHigh ? `A refund is coming - ${money(fed - fedHigh)} above your ${money(fedLow)} - ${money(fedHigh)} target.` : `Right inside your ${money(fedLow)} - ${money(fedHigh)} target.`}</Text>
            <Text style={styles.actionLine}>{gaugeAction(fed, fedLow, fedHigh, "federal")}</Text>
            <Text style={styles.rangeLine}>{rangeFor(fed, domains.federalTax.level)}</Text>
            <Text style={styles.rangeLine}>Federal tax accuracy: {domains.federalTax.label} ({domains.federalTax.level})</Text>
            {snap && !snap.medicareIncluded && <Text style={styles.rangeLine}>Before final Medicare reconciliation - add payslips in Documents and HomeTower runs the Additional Medicare calculation too.</Text>}
            {snap && snap.medicareIncluded && slipFc && slipFc.medicareBasis === "estimated" && <Text style={styles.rangeLine}>Medicare is estimated from your pay for now - the calculation below says how.</Text>}
          </>
        ) : (
          <Text style={styles.line}>No income added yet - this is not a $0 refund, it is a blank. Upload a payslip in Documents and HomeTower projects your refund against your {money(fedLow)} - {money(fedHigh)} target.</Text>
        )}
      </View>

      <View style={styles.card}>
        <View style={styles.cardHead}>
          <View style={styles.labelRow}>
            <StateFlag state={state.intake.state} />
            <Text style={styles.cardLabel}>{state.intake.state} state projection</Text>
          </View>
          {hasIncome && <Text adjustsFontSizeToFit numberOfLines={1} style={[styles.bigValue, { color: st < 0 ? RED : st >= g.stateRefundTargetLow && st <= g.stateRefundTargetHigh ? GREEN : YELLOW }]}>{st < 0 ? `You owe ${money(-st)}` : `Refund ${money(st)}`}</Text>}
        </View>
        {hasIncome ? (
          <>
            <RefundGauge value={st} low={g.stateRefundTargetLow} high={g.stateRefundTargetHigh} />
            <Text style={styles.line}>{st < 0 ? `At this pace you owe the state ${money(-st)} - your target is a ${money(g.stateRefundTargetLow)} - ${money(g.stateRefundTargetHigh)} refund.` : st < g.stateRefundTargetLow ? `A refund is coming - ${money(g.stateRefundTargetLow - st)} below your ${money(g.stateRefundTargetLow)} - ${money(g.stateRefundTargetHigh)} target.` : st > g.stateRefundTargetHigh ? `A refund is coming - ${money(st - g.stateRefundTargetHigh)} above your ${money(g.stateRefundTargetLow)} - ${money(g.stateRefundTargetHigh)} target.` : `Right inside your ${money(g.stateRefundTargetLow)} - ${money(g.stateRefundTargetHigh)} target.`}</Text>
            <Text style={styles.actionLine}>{gaugeAction(st, g.stateRefundTargetLow, g.stateRefundTargetHigh, "state")}</Text>
            <Text style={styles.rangeLine}>{rangeFor(st, domains.stateTax.level)}</Text>
            {stateModelLabel && <Text style={styles.rangeLine}>{stateModelLabel}</Text>}
            <Text style={styles.rangeLine}>State tax accuracy: {domains.stateTax.label} ({domains.stateTax.level})</Text>
          </>
        ) : (
          <Text style={styles.line}>Same story on the state side: no income yet, so no projection. Your state target stays {money(g.stateRefundTargetLow)} - {money(g.stateRefundTargetHigh)}.</Text>
        )}
      </View>

      {hasIncome && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Combined tax position</Text>
          <Text style={styles.combinedValue}>{combinedHeadline}</Text>
          <Text style={styles.line}>Federal: {sidePhrase(fed)} · {state.intake.state}: {sidePhrase(st)}</Text>
          <Text style={styles.line}>{combinedVerdict}</Text>
        </View>
      )}

      {slipFc && (
        <Text style={styles.assumption}>* Forecast basis - see the note at the bottom of this page.</Text>
      )}

      {!slipFc && gaps.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Your payslips are saved - two readings are incomplete</Text>
          {gaps.map((gp) => (
            <Text key={gp.name} style={styles.line}>
              {gp.name}: missing {gp.missing.join(" and ")}.
            </Text>
          ))}
          <Text style={styles.line}>
            The forecast starts as soon as each earner has both figures on any saved slip.
            A Workday PDF of one regular slip per earner always contains them - upload it
            from the Payslips card in Documents (Upload a statement).
          </Text>
        </View>
      )}

      {adults.length > 0 && (
        <Pressable
          style={styles.card}
          onPress={() => { setRetirementIntent("readiness"); navigation.navigate("Plan"); }}
        >
          <Text style={styles.cardLabel}>{useDirectionalFace ? "Retirement outlook" : "Retirement Readiness **"}</Text>
          {adultOutlook.every((a) => a.age === null) ? (
            <>
              <Text style={styles.statusLine}>Not ready to score</Text>
              <Text style={styles.line}>Add dates of birth in the {state.intake.name || "My House"} tab and HomeTower can time this.</Text>
              <Text style={styles.line}>{accuracyLine}</Text>
            </>
          ) : spendingAnnual <= 0 ? (
            <>
              <Text style={styles.statusLine}>Not ready to score</Text>
              <Text style={styles.line}>Add household income (or a retirement spending target in the {state.intake.name || "My House"} tab) so HomeTower can estimate how much is enough.</Text>
              <Text style={styles.line}>{accuracyLine}</Text>
            </>
          ) : coveredByDependable ? (
            <>
              <Text style={styles.statusLine}>On track</Text>
              <View style={styles.tilesRow}>
                <View style={styles.tile}>
                  <Text numberOfLines={1} style={styles.tileValue}>{moneyShort(projectedToday)}</Text>
                  <Text style={styles.tileLabel}>Projected (today's $)</Text>
                </View>
                <View style={styles.tile}>
                  <Text numberOfLines={1} style={styles.tileValue}>{moneyShort(spendingAnnual)}</Text>
                  <Text style={styles.tileLabel}>{spendingKnown ? "Your household target" : "Estimated target *"}</Text>
                </View>
                <View style={styles.tile}>
                  <Text numberOfLines={1} style={[styles.tileValue, { color: GREEN }]}>Covered</Text>
                  <Text style={styles.tileLabel}>Readiness</Text>
                </View>
              </View>
              <Text style={styles.line}>Dependable income covers the target on its own - {money(hhRet.dependableAnnual)}/year.</Text>
              <Text style={styles.line}>{accuracyLine}</Text>
              <Text style={styles.line}>No action needed - review once a year.</Text>
            </>
          ) : useDirectionalFace && directional && retDisplay ? (
            <>
              <Text style={styles.statusLine}>{STATUS_DOT[retDisplay.colorKey]} {retDisplay.label}</Text>
              {retDisplay.support && <Text style={styles.line}>{retDisplay.support}</Text>}
              <Text style={styles.confLine}>Early estimate - Low confidence</Text>
              <View style={styles.bigRow}>
                <View style={styles.bigTile}>
                  <Text style={styles.bigValue2}>{directional.desiredAge}</Text>
                  <Text style={styles.bigLabel}>Desired</Text>
                </View>
                <View style={styles.bigTile}>
                  <Text style={styles.bigValue2}>{retModel.homeRangeLabel ?? directional.rangeLabel}</Text>
                  <Text style={styles.bigLabel}>Current path</Text>
                </View>
              </View>
              {retModel.homeTimeline && <RetirementTimeline timeline={retModel.homeTimeline} colorKey={retDisplay.colorKey} compact />}
              {retModel.opportunityLine && <Text style={styles.line}>{retModel.opportunityLine}</Text>}
              <Pressable style={styles.button} onPress={() => { setWizardIntent(); navigation.navigate("Lifestyle"); }}>
                <Text style={styles.buttonText}>Improve estimate</Text>
              </Pressable>
            </>
          ) : accuracy.level === "X" ? (
            <>
              <Text style={styles.statusLine}>Not ready to score</Text>
              <View style={styles.tilesRow}>
                <View style={styles.tile}>
                  <Text numberOfLines={1} style={styles.tileValue}>{moneyShort(projectedToday)}</Text>
                  <Text style={styles.tileLabel}>Projected (today's $)</Text>
                </View>
                <View style={styles.tile}>
                  <Text style={styles.tileNote}>Not personalized yet</Text>
                  <Text style={styles.tileLabel}>Retirement target</Text>
                </View>
                <View style={styles.tile}>
                  <Text numberOfLines={1} style={styles.tileValue}>{accuracy.missing.length}</Text>
                  <Text style={styles.tileLabel}>Inputs needed</Text>
                </View>
              </View>
              <Text style={styles.line}>{accuracyLine}</Text>
              {personalizeSentence !== "" && <Text style={styles.line}>{personalizeSentence}</Text>}
              <Pressable style={styles.button} onPress={() => { setWizardIntent(); navigation.navigate("Lifestyle"); }}>
                <Text style={styles.buttonText}>Complete {accuracy.missing.length} retirement inputs</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.statusLine}>{retHeadline}</Text>
              <View style={styles.tilesRow}>
                <View style={styles.tile}>
                  <Text numberOfLines={1} style={styles.tileValue}>{moneyShort(projectedToday)}</Text>
                  <Text style={styles.tileLabel}>Projected (today's $)</Text>
                </View>
                <View style={styles.tile}>
                  <Text numberOfLines={1} style={styles.tileValue}>{moneyShort(hhRet.needBase)}</Text>
                  <Text style={styles.tileLabel}>{spendingKnown ? "Your household target" : "Estimated target *"}</Text>
                </View>
                <View style={styles.tile}>
                  <Text numberOfLines={1} style={[styles.tileValue, { color: projectedToday >= hhRet.needBase ? GREEN : (readinessPct ?? 0) >= 50 ? YELLOW : RED }]}>{readinessPct}%</Text>
                  <Text style={styles.tileLabel}>Readiness</Text>
                </View>
              </View>
              <Text style={styles.line}>{hhShort > 0 ? `Shortfall ${money(hhShort)}` : `Surplus ${money(projectedToday - hhRet.needBase)}`}</Text>
              <Text style={styles.line}>{accuracyLine}</Text>
              {hhShort > 0 ? (hhReqMo > 0 ? <Text style={styles.line}>Save about {money(hhReqMo)}/mo more to close the gap.</Text> : null) : <Text style={styles.line}>No action needed - review once a year.</Text>}
            </>
          )}
          <Pressable onPress={() => setShowRetDetails(!showRetDetails)}>
            <Text style={styles.manualLink}>View details {showRetDetails ? "(hide)" : "(show)"}</Text>
          </Pressable>
          {showRetDetails && (
            <RetirementDetails model={retModel} g={g} householdName={state.intake.name} k401Totals={k401Totals} today={today} />
          )}
        </Pressable>
      )}

      {children.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Education - timing and funding, per child **</Text>
          {domains.education && <Text style={styles.line}>Education accuracy: {domains.education.label} ({domains.education.level}) - {domains.education.basis}</Text>}
          {eduOutlook.map(({ c, yearsToStart, duration, funding, usingDefaultCost, earlyEstimate }) => {
            const pct = funding.pctFunded ?? 0;
            return (
              <View key={c.id} style={styles.personBlock}>
                <Text style={styles.personName}>🎓 {educationLine(c.name || "Child", c.dob, c.studentNow, c.collegeStartYear, c.yearsLeftInCollege, today)}</Text>
                <View style={styles.tilesRow}>
                  <View style={styles.tile}>
                    <Text numberOfLines={1} style={[styles.tileValue, { color: earlyEstimate ? YELLOW : funding.gap <= 0 ? GREEN : pct >= 70 ? YELLOW : RED }]}>{pct}%</Text>
                    <Text style={styles.tileLabel}>Funded</Text>
                  </View>
                  <View style={styles.tile}>
                    <Text numberOfLines={1} style={styles.tileValue}>{moneyShort(funding.projectedAtStart)}</Text>
                    <Text style={styles.tileLabel}>Saved by start</Text>
                  </View>
                  <View style={styles.tile}>
                    <Text numberOfLines={1} style={styles.tileValue}>{moneyShort(funding.needAtStart)}</Text>
                    <Text style={styles.tileLabel}>Need ({duration} yrs)</Text>
                  </View>
                </View>
                {earlyEstimate ? (
                  <Text style={styles.line}>{funding.gap <= 0
                    ? "🟡 Early estimate - default college costs: covered under those default assumptions - not yet a verdict."
                    : `🟡 Early estimate - default college costs: projected gap about ${money(funding.gap)} under those default assumptions - set real costs in the ${state.intake.name || "My House"} tab for a firm verdict.`}{c.eduScholarshipYear ? ` After a ${money(c.eduScholarshipYear)}/yr scholarship.` : ""}</Text>
                ) : (
                  <Text style={styles.line}>{funding.gap <= 0 ? "🟢 Covered." : yearsToStart > 0 ? `🔴 Gap ${money(funding.gap)} - save ${money(funding.requiredMonthly)}/mo (now ${money(c.eduMonthly || 0)}/mo) to close it.` : `🔴 Gap ${money(funding.gap)} - college is here: cash flow, loans, or a cheaper plan.`}{c.eduScholarshipYear ? ` After a ${money(c.eduScholarshipYear)}/yr scholarship.` : ""}</Text>
                )}
              </View>
            );
          })}
          {eduOutlook.some((e) => e.usingDefaultCost) && (
            <Text style={styles.footnote}>Default costs apply until real ones are set in the {state.intake.name || "My House"} tab.</Text>
          )}
        </View>
      )}

      {!hasIncome ? (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Your tax picture - waiting for income</Text>
          <Text style={styles.line}>Once income is in, three numbers appear here in plain words: your top tax rate, how much room is left in that bracket, and your projected total tax. Right now there is no income, so HomeTower shows nothing rather than a meaningless bracket.</Text>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Your tax picture</Text>
          <View style={styles.taxRow}>
            <Text style={styles.taxValue}>{(snap.marginalRate * 100).toFixed(0)}%</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.taxName}>Your top tax rate</Text>
              <Text style={styles.taxNote}>Your current federal marginal rate - additional ordinary income is generally taxed at this rate until the next bracket.</Text>
            </View>
          </View>
          <View style={styles.taxRow}>
            <Text style={styles.taxValue}>{money(snap.distanceToNextBracket)}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.taxName}>Room left in this bracket</Text>
              <Text style={styles.taxNote}>Income you can still earn before the rate goes up.</Text>
            </View>
          </View>
          <View style={styles.taxRow}>
            <Text style={styles.taxValue}>{money(snap.totalFederalLiability)}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.taxName}>Projected federal tax</Text>
              <Text style={styles.taxNote}>{snap.medicareIncluded ? "Income tax, NIIT and Additional Medicare combined, for the whole year - before the payments you already made." : "For the whole year, before the withholding you already paid."}</Text>
            </View>
          </View>
          <Pressable onPress={() => setShowCalc((v) => !v)}>
            <Text style={styles.manualLink}>{showCalc ? "Hide the calculation ✕" : "How we calculated this ›"}</Text>
          </Pressable>
          {showCalc && fedDetail && (
            <View style={styles.calcBlock}>
              <Text style={styles.calcRow}>{slipFc ? "Projected W-2 wages" : "Income"}: {money(effIncome)}</Text>
              <Text style={styles.calcRow}>Standard deduction ({state.intake.filingStatus}): -{money(fedDetail.standardDeduction)}</Text>
              <Text style={styles.calcRow}>Taxable income: {money(fedDetail.taxableIncome)}</Text>
              <Text style={styles.calcRow}>Federal income tax: {money(fedDetail.ordinaryTax + fedDetail.ltcgTax)}{fedDetail.ltcgTax > 0 ? ` (including ${money(fedDetail.ltcgTax)} on long-term capital gains)` : ""}</Text>
              <Text style={styles.calcRow}>Net investment income tax (NIIT): {money(snap.niit)}</Text>
              <Text style={styles.calcRow}>NIIT base: net investment income subject to NIIT {money(snap.niitNiiSubject)}; MAGI above the threshold {money(snap.niitMagiExcess)}; the 3.8% runs on the lesser of the two, {money(snap.niitBase)}.{snap.niit === 0 ? snap.niitNiiSubject === 0 ? " That is why the NIIT is $0 here: no net investment income is in this forecast." : " That is why the NIIT is $0 here." : ""}</Text>
              {snap.medicareIncluded && slipFc ? (
                <>
                  <Text style={styles.calcRow}>Additional Medicare tax: {money(snap.additionalMedicareLiability)} - 0.9% of Medicare wages above the joint threshold, on {money(slipFc.projectedMedicareWages)} of projected Medicare wages.</Text>
                  <Text style={styles.calcRow}>Already withheld toward it (the part of Medicare withholding above the 1.45% base rate): -{money(snap.additionalMedicareWithheld)}</Text>
                  <Text style={styles.calcRow}>Net Additional Medicare in this forecast: {money(snap.additionalMedicareNet)}</Text>
                  <Text style={styles.calcRow}>{slipFc.medicareBasis === "read" ? "Medicare figures were read from your payslips." : "Your payslips do not show a Medicare line yet, so Medicare withholding is estimated from your pay at the statutory rates (1.45%, plus 0.9% over $200,000 for each earner). A slip that prints the Medicare line makes it exact."}</Text>
                </>
              ) : (
                <Text style={styles.calcRow}>Not in this estimate yet: Additional Medicare tax - it is calculated from your payslips, so add the latest ones in Documents; and any credits.</Text>
              )}
              <Text style={styles.calcRow}>{state.intake.state} state tax: {money(snap.stateTax)} - projected in the state gauge above; it is not part of the federal figure.</Text>
              <Text style={styles.calcRow}>Total federal liability: {money(snap.totalFederalLiability)}</Text>
              <Text style={styles.calcRow}>Total federal payments: {money(snap.totalFederalPayments)}{snap.medicareIncluded ? " (income-tax withholding plus the Additional Medicare withheld above)" : " (income-tax withholding)"}</Text>
              <Text style={styles.calcRow}>{snap.federalRefundOwe >= 0 ? `Projected federal refund: ${money(snap.federalRefundOwe)} - the figure in the federal gauge above.` : `Projected federal amount owed: ${money(-snap.federalRefundOwe)} - the figure in the federal gauge above.`}</Text>
            </View>
          )}
        </View>
      )}

      <View style={styles.card}>
        <View style={styles.confRow}>
          <RingGauge pct={confidence.score} label={`Data completeness (${confidence.band})`} color={confColor} />
          <View style={{ flex: 1 }}>
            <Text style={styles.cardLabel}>What would raise it</Text>
            {confidence.reasons.length === 0 ? (
              <Text style={styles.line}>Nothing is missing - the forecast is running on current, verified documents.</Text>
            ) : (
              confidence.reasons.map((r, i) => (
                <Text key={i} style={styles.line}>• {prettyReason(r)}</Text>
              ))
            )}
            <Pressable onPress={() => navigation.navigate("Documents")}>
              <Text style={styles.manualLink}>Open Documents - missing items are marked there</Text>
            </Pressable>
            <Text style={[styles.cardLabel, { marginTop: 10 }]}>What this forecast is based on</Text>
            {provenance.map((p, i) => (
              <Text key={i} style={styles.line}>{p}</Text>
            ))}
            <Text style={[styles.cardLabel, { marginTop: 10 }]}>Accuracy by area</Text>
            <Text style={styles.line}>The ring counts the documents on file - completeness, not the accuracy of any one forecast. Each area carries its own level, from its own evidence:</Text>
            <Text style={styles.line}>Federal tax: {domains.federalTax.label} ({domains.federalTax.level}) - {domains.federalTax.basis}</Text>
            <Text style={styles.line}>{state.intake.state} tax: {domains.stateTax.label} ({domains.stateTax.level}) - {domains.stateTax.basis}</Text>
            <Text style={styles.line}>Retirement: {domains.retirement.label} ({domains.retirement.level})</Text>
            {domains.education && <Text style={styles.line}>Education: {domains.education.label} ({domains.education.level}) - {domains.education.basis}</Text>}
            <Text style={styles.line}>HSA: {domains.hsa.label} ({domains.hsa.level}) - {domains.hsa.basis}</Text>
          </View>
        </View>
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
                <Text key={l.ticker} style={styles.line}><Text style={{ color: l.changePct >= 0 ? GREEN : RED, fontWeight: "800" }}>{l.changePct >= 0 ? "▲" : "▼"}</Text> {l.ticker}: ${l.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, {l.changePct >= 0 ? "+" : "-"}{Math.abs(l.changePct).toFixed(2)}%{l.alert ? " ⚠️ big move" : ""}</Text>
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

      {(slipFc || adults.length > 0 || children.length > 0) && (
        <View style={styles.notesBlock}>
          {slipFc && (
            <Text style={styles.footnote}>
              * Forecast from your payslips: {slipFc.earners.map((e) => `${e.name.split(" ")[0]} through ${isoToUs(e.anchorEnd)}, + ${e.periodsRemaining} pay periods at the current rate`).join(" · ")}. Projected W-2 wages {money(slipFc.projectedTaxable)} for the year; the withholding in the gauges is projected to year-end, not yet paid. Remove the payslips and the typed Intake numbers take over again.
            </Text>
          )}
          {(adults.length > 0 || children.length > 0) && (
            <Text style={styles.footnote}>** Retirement figures are in today's dollars (inflation {g.inflationPct}%) and assume {g.assumedReturnPct}% yearly growth - editable assumptions in My House and Intake, not promises. The retirement need uses the Balanced 4.0% starting withdrawal rate; More Safety (3.5%) needs more saved, More Flexible Spending (4.5%) needs less.</Text>
          )}
        </View>
      )}

      <Text style={styles.pushLine}>
        Push: {push && isPushEnabled(state.pushEnabled, push) ? `on, ${push.scheduledCount} reminder(s) scheduled` : state.pushEnabled ? "on (Intake tab) - token registers in the native app" : "off - turn it on in the Intake tab"}
      </Text>
    </ScrollView>

    <Modal visible={tasksOpen} animationType="slide" onRequestClose={() => setTasksOpen(false)}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.taskHead}>
          <Text style={styles.household}>Your tasks</Text>
          <Pressable onPress={() => setTasksOpen(false)}>
            <Text style={styles.manualLink}>Close ✕</Text>
          </Pressable>
        </View>
        <Text style={styles.subtitle}>Everything HomeTower is waiting on, in one list - the Home page itself stays indicators only.</Text>

        <View style={styles.actionCard}>
          <Text style={styles.actionLabel}>NEXT ACTION</Text>
          <Text style={styles.actionText}>{action.action}</Text>
          <Text style={styles.actionRow}><Text style={styles.actionKey}>Why: </Text>{action.why}</Text>
          <Text style={styles.actionRow}><Text style={styles.actionKey}>Expected benefit: </Text>{action.expectedBenefit}</Text>
          <Text style={styles.actionRow}><Text style={styles.actionKey}>Trade-off: </Text>{action.tradeOff}</Text>
          <Text style={styles.actionRow}><Text style={styles.actionKey}>Data completeness behind this: </Text>{action.confidence}</Text>
          <Text style={styles.actionRow}><Text style={styles.actionKey}>What could change this: </Text>{action.whatCouldChange}</Text>
          {actionTarget && (
            <Pressable style={styles.button} onPress={() => { setTasksOpen(false); navigation.navigate(actionTarget); }}>
              <Text style={styles.buttonText}>Go to {actionTarget === "MyHouse" ? state.intake.name || "My House" : actionTarget}</Text>
            </Pressable>
          )}
        </View>

        {tasks.slice(1).map((t) => (
          <Pressable
            key={t.key}
            style={styles.taskRow}
            onPress={() => { if (t.target) { setTasksOpen(false); if (t.key === "ret-personalize" && t.target === "Lifestyle") setWizardIntent(); navigation.navigate(t.target); } }}
          >
            <Text style={styles.taskRowIcon}>{t.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.taskRowTitle}>{t.title}</Text>
              {t.detail && <Text style={styles.taskRowDetail}>{t.detail}</Text>}
            </View>
            {t.target && <Text style={styles.taskStripGo}>›</Text>}
          </Pressable>
        ))}

        <View style={styles.card}>
          <Text style={styles.cardLabel}>📅 {phase.title}</Text>
          <Text style={styles.line}>This phase of the annual planning cycle: {phase.items.join(" · ")}</Text>
          <Text style={styles.line}>Next: {nextPhase.title} (starts {MONTH_NAMES[nextPhase.month - 1]})</Text>
        </View>
      </ScrollView>
    </Modal>
    </>
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
  taskStrip: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#FFFFFF", borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, borderWidth: 2, borderColor: TEAL },
  taskStripIcon: { fontSize: 20 },
  taskStripTitle: { fontSize: 16, fontWeight: "800", color: NAVY },
  taskStripNext: { fontSize: 13.5, color: "#5A6B7C" },
  taskStripGo: { fontSize: 16, fontWeight: "800", color: TEAL },
  taskHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  taskRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#FFFFFF", borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14 },
  taskRowIcon: { fontSize: 18 },
  taskRowTitle: { fontSize: 15, fontWeight: "700", color: "#22303C" },
  taskRowDetail: { fontSize: 13, color: "#5A6B7C", marginTop: 2 },
  button: { backgroundColor: TEAL, borderRadius: 10, paddingVertical: 11, alignItems: "center", marginTop: 6 },
  buttonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  barTrack: { height: 10, borderRadius: 999, backgroundColor: "#EDF2F6", overflow: "hidden", marginTop: 6 },
  barFill: { height: 10, borderRadius: 999 },
  tilesRow: { flexDirection: "row", gap: 8, marginTop: 6 },
  tile: { flex: 1, backgroundColor: "#F4F7FA", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 6, alignItems: "center" },
  tileValue: { fontSize: 19, fontWeight: "800", color: NAVY },
  tileNote: { fontSize: 14, fontWeight: "800", color: NAVY, textAlign: "center", lineHeight: 18 },
  statusLine: { fontSize: 21, fontWeight: "800", color: NAVY },
  // Round 53 X-face pieces: the confidence tag, the two big numbers.
  confLine: { fontSize: 13, color: "#5A6B7C", fontWeight: "700", marginTop: 2 },
  bigRow: { flexDirection: "row", gap: 10, marginTop: 10 },
  bigTile: { flex: 1, backgroundColor: "#F4F7FA", borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  bigValue2: { fontSize: 32, fontWeight: "800", color: NAVY },
  bigLabel: { fontSize: 13, color: "#5A6B7C", fontWeight: "700", marginTop: 2 },
  tileLabel: { fontSize: 11, color: "#5A6B7C", textAlign: "center", marginTop: 2 },
  footnote: { fontSize: 12, color: "#5A6B7C", marginTop: 8 },
  notesBlock: { gap: 2, marginTop: 2 },
  taxRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  taxValue: { fontSize: 21, fontWeight: "800", color: NAVY, minWidth: 108 },
  taxName: { fontSize: 15, fontWeight: "700", color: "#22303C" },
  taxNote: { fontSize: 13, color: "#5A6B7C", marginTop: 1 },
  confRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  actionLine: { fontSize: 13.5, fontWeight: "700", color: NAVY, marginTop: 4 },
  rangeLine: { fontSize: 12.5, color: "#5A6B7C", marginTop: 2 },
  combinedValue: { fontSize: 21, fontWeight: "800", color: NAVY },
  calcBlock: { gap: 2, marginTop: 4 },
  calcRow: { fontSize: 13.5, color: "#22303C" },
});
