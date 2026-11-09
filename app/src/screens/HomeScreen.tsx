import React, { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { predictionConfidence } from "../../engine/confidence.ts";
import { householdFreshness, reminderCandidates } from "../../engine/freshness.ts";
import { annualFocus, documentRequests, nextAction, nextPhaseStart } from "../../engine/guidance.ts";
import { computeHouseholdTax } from "../../engine/snapshot.ts";
import { computeFederalTax } from "../../engine/federal.ts";
import { GREEN, RED, RefundGauge, RingGauge, YELLOW } from "../components/Gauge.tsx";
import { StateFlag } from "../components/StateFlag.tsx";
import { ageOn, chooseSpending, deflateToToday, educationFunding, educationLine, householdRetirement, inflateToFuture, projectToCommonDate, projectValue, requiredMonthly, retirementAccuracy, ssForMember, WITHDRAWAL_RATES } from "../goals.ts";
import { isoToUs } from "../components/Fields.tsx";
import { getPushStatus, isPushEnabled, syncStaleReminders, type PushStatus } from "../push.ts";
import { composeCloseReport, deriveHoldings, type CloseReport } from "../market.ts";
import { payslip401kTotals, payslipForecast, payslipGaps } from "../payslips.ts";
import { fetchQuotes, type QuotesOutcome } from "../quotes";
import { buildProfileExtras, todayIso, useHousehold } from "../store.tsx";

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

  // Retirement outlook per adult (owner QA round 18): not a ring - an
  // answer. Can this person retire at the age they chose, at today's
  // pace? If not, at what age does the money work, or what monthly
  // contribution makes the chosen age work?
  const adults = state.family.filter((m) => m.role === "self" || m.role === "spouse");
  const adultOutlook = adults.map((m) => {
    const age = ageOn(m.dob, today);
    const owned = state.assets.filter((a) => (a.kind === "401k" || a.kind === "ira" || a.kind === "hsa") && m.name.trim() !== "" && a.ownerName.trim().toLowerCase() === m.name.trim().toLowerCase());
    const bal = owned.length ? owned.reduce((s, a) => s + a.value, 0) : m.role === "self" ? retBalance : 0;
    const assetMo = owned.length ? owned.reduce((s, a) => s + a.monthly, 0) : m.role === "self" ? retMonthly : 0;
    // Payslip evidence (owner QA, 2026-11-08): when no asset row
    // carries a monthly figure, the payroll pace the payslips prove
    // is the pace - the outlook must not claim $0/mo for a household
    // whose slips show thousands a month going into the 401(k).
    // Entered assets still win when they exist.
    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
    const slipEarner = k401Totals?.perEarner.find((e) => norm(e.name) === norm(m.name))
      ?? k401Totals?.perEarner.find((e) => { const a = norm(e.name).split(" "); const b = norm(m.name).split(" "); return a.length > 1 && b.length > 1 && a[0] === b[0] && a[a.length - 1] === b[b.length - 1]; });
    const paceFromSlips = !(assetMo > 0) && slipEarner?.monthlyPace != null && slipEarner.monthlyPace > 0;
    const mo = assetMo > 0 ? assetMo : paceFromSlips ? slipEarner!.monthlyPace! : assetMo;
    if (age === null) return { m, age, bal, mo, years: 0, projected: 0, paceFromSlips };
    const years = Math.max(0, (m.retireAge || 67) - age);
    const projected = projectValue(bal, mo, years, g.assumedReturnPct);
    return { m, age, bal, mo, years, projected, paceFromSlips };
  });

  // Retirement is a HOUSEHOLD goal (round 46, Copilot's pension
  // review): the spending target minus dependable income (Social
  // Security + pension + other), divided by a starting withdrawal
  // rate - never a per-person figure doubled, because a couple
  // shares housing, utilities, insurance and food. Per-person rows
  // below stay as attribution: balances and accounts ARE personal.
  const incomeBasis = slipFc ? slipFc.projectedGross : effIncome;
  // Round 48: the spending target's source, in order - the
  // Retirement Lifestyle page once the household confirms it (built
  // from actual spending), then a custom figure, then the budget
  // worksheet, then the 70%-of-income fallback. The fallback is a
  // placeholder and is labelled as one - never as the household's
  // own target.
  // Round 49: the confirmed figure is the EFFECTIVE lifestyle figure
  // (category model + exception overlays), and the quick estimate
  // joins the precedence between the budget worksheet and the
  // fallback - chooseSpending in goals.ts owns the order and tiers.
  const budgetTotalR = (g.retirementBudget.housing || 0) + (g.retirementBudget.food || 0) + (g.retirementBudget.healthcare || 0) + (g.retirementBudget.travel || 0) + (g.retirementBudget.other || 0);
  const spendingChoice = chooseSpending({ lifestyle: g.lifestyle, exceptions: g.exceptions, customAnnual: g.retirementSpendingAnnual || 0, budgetTotal: budgetTotalR, quick: g.quickEstimate, fallback: Math.round(incomeBasis * 0.7) });
  const spendingTier = spendingChoice.tier;
  const lifestyleConfirmed = spendingTier === "confirmed";
  const spendingFromBudget = spendingTier === "set" && !(g.retirementSpendingAnnual > 0) && budgetTotalR > 0;
  const spendingSet = spendingTier !== "none"; // a quick estimate counts as supplied (round 49)
  const spendingFromDefault = !spendingSet;
  const spendingAnnual = spendingChoice.spendingAnnual;
  // Social Security per adult (round 49): a typed figure wins, else
  // the adult's own Social Security statement (monthly benefit x 12).
  const ssPerAdult = adults.map((m) => ssForMember(m, state.intake.documents));
  const ssAnnualTotal = ssPerAdult.reduce((sum, r) => sum + r.annual, 0);
  const ssEnteredAdults = ssPerAdult.filter((r) => r.annual > 0).length;
  const pensionStmtMonthly = state.intake.documents.reduce((best, d) => {
    if (d.docType !== "pension_statement" || !d.fields) return best;
    const v = Number(String(d.fields["monthly_benefit"] ?? "").replace(/[^0-9.]/g, ""));
    return Number.isFinite(v) && v > best ? v : best;
  }, 0);
  const memberPension = adults.reduce((sum, m) => sum + (m.pensionAnnual || 0), 0);
  const pensionFromStatement = memberPension <= 0 && !(g.pensionAnnual > 0) && pensionStmtMonthly > 0;
  const pensionAnnualEff = memberPension > 0 ? memberPension : g.pensionAnnual > 0 ? g.pensionAnnual : Math.round(pensionStmtMonthly * 12);
  const pensionKnown = memberPension > 0 || g.pensionAnnual > 0 || pensionStmtMonthly > 0 || g.noPension;
  const currentRetBalance = adultOutlook.reduce((sum, a) => sum + a.bal, 0);
  // Timeline (round 47): every adult is valued at the LATER
  // retirement date - contributions stop at their own date, the
  // balance keeps growing, no bridge draws (the working spouse's
  // income covers the bridge years; the assumptions drawer says so).
  // All household figures are then deflated to today's dollars,
  // because the spending target is in today's dollars.
  const flexYearsOf = (m: (typeof adults)[number]) => (m.retireFlex === "plus1" ? 1 : m.retireFlex === "plus3" || m.retireFlex === "flexible" ? 3 : 0);
  const projectHousehold = (delay: boolean) => {
    const yearsOwn = adultOutlook.map((a) => a.years + (delay ? flexYearsOf(a.m) : 0));
    const laterYears = yearsOwn.reduce((mx, y) => Math.max(mx, y), 0);
    const perAtLater = adultOutlook.map((a, i) => projectToCommonDate(a.bal, a.mo, yearsOwn[i], laterYears, g.assumedReturnPct));
    const nominal = perAtLater.reduce((sum, v) => sum + v, 0);
    return { yearsOwn, laterYears, perAtLater, nominal, todays: deflateToToday(nominal, laterYears, g.inflationPct) };
  };
  const projNow = projectHousehold(false);
  const projectedToday = projNow.todays;
  const thisYearR = Number(today.slice(0, 4));
  const laterYear = thisYearR + Math.round(projNow.laterYears);
  const hhRet = householdRetirement({ spendingAnnual, socialSecurityAnnual: ssAnnualTotal, pensionAnnual: pensionAnnualEff, otherAnnual: g.otherRetirementIncomeAnnual || 0, projectedPortfolio: projectedToday });
  const readinessPct = hhRet.needBase > 0 ? Math.round((projectedToday / hhRet.needBase) * 100) : null;
  const realReturnPct = Math.max(0, ((1 + g.assumedReturnPct / 100) / (1 + (g.inflationPct || 0) / 100) - 1) * 100);
  const hhShort = Math.max(0, hhRet.needBase - projectedToday);
  const hhReqMo = hhRet.needBase > 0 && projNow.laterYears > 0 ? Math.round(requiredMonthly(currentRetBalance, hhRet.needBase, projNow.laterYears, realReturnPct)) : 0;
  const accuracy = retirementAccuracy({ spendingSet, ssEnteredAdults, adultCount: adults.length, pensionKnown, hasBalances: currentRetBalance > 0, hasPace: adultOutlook.some((a) => a.mo > 0) });
  const projDelay = projectHousehold(true);
  const delayReadiness = hhRet.needBase > 0 ? Math.round((projDelay.todays / hhRet.needBase) * 100) : null;
  const showSensitivity = projDelay.laterYears > projNow.laterYears && readinessPct !== null && readinessPct < 100 && delayReadiness !== null && delayReadiness > readinessPct;
  const futureNeed = Math.round(inflateToFuture(hhRet.needBase, projNow.laterYears, g.inflationPct));
  const supportAnnual = Math.round(projectedToday * WITHDRAWAL_RATES.base);
  // Round 48 card-face model (Copilot's UX verdict on round 47):
  // five seconds to understand - one status headline, three tiles,
  // the accuracy line, one next action. At accuracy X the fallback
  // target is product-invalid as a displayed target, so the face
  // shows no target figure and no readiness % at all.
  const accuracyLine = accuracy.level === "X" ? "Retirement estimate - early estimate, personalization needed." : accuracy.level === "X+" ? "Planning forecast." : "High-confidence planning forecast.";
  const coveredByDependable = spendingAnnual > 0 && hhRet.portfolioGapAnnual <= 0;
  const retHeadline = coveredByDependable || (hhRet.needBase > 0 && projectedToday >= hhRet.needBase) ? "On track" : accuracy.level === "X++" ? "Projected shortfall" : "Needs attention";
  const spendingKnown = spendingTier === "confirmed"; // round 49: only a confirmed lifestyle figure earns "Your household target"
  const personalizeParts = accuracy.missing.map((mm) => (mm.includes("spending") ? "retirement spending" : mm.includes("Social Security") ? "Social Security" : "pension or other reliable income"));
  const personalizeSentence = personalizeParts.length > 0 ? `Add ${personalizeParts.length > 1 ? `${personalizeParts.slice(0, -1).join(", ")} and ${personalizeParts[personalizeParts.length - 1]}` : personalizeParts[0]} to personalize it.` : "";
  const phases = (() => {
    if (adultOutlook.length < 2) return null;
    const order = projNow.yearsOwn.map((y, i) => ({ y, i })).sort((x, z) => x.y - z.y);
    if (order.length < 2 || Math.abs(order[0].y - order[1].y) < 0.5) return null;
    const early = adultOutlook[order[0].i];
    const late = adultOutlook[order[1].i];
    return { earlyName: early.m.name || "One spouse", lateName: late.m.name || "the other", y1: thisYearR + Math.round(order[0].y), y2: thisYearR + Math.round(order[1].y) };
  })();
  const updatedLabel = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][Number(today.slice(5, 7)) - 1] + " " + today.slice(0, 4);

  // Education funding per child (owner QA round 18, SPEC45 sec. 32):
  // saved vs the real cost path - per child, with their own dates.
  const thisYear = Number(today.slice(0, 4));
  const eduOutlook = children.map((c) => {
    const age = ageOn(c.dob, today);
    let yearsToStart = 0;
    if (!c.studentNow && c.collegeStartYear > 0) yearsToStart = Math.max(0, c.collegeStartYear - thisYear);
    else if (!c.studentNow && age !== null) yearsToStart = Math.max(0, 18 - age);
    const duration = c.studentNow && c.yearsLeftInCollege > 0 ? c.yearsLeftInCollege : c.eduDurationYears || 4;
    const usingDefaultCost = !(c.eduAnnualCost > 0);
    const effCost = usingDefaultCost ? DEFAULT_EDU_ANNUAL_COST : c.eduAnnualCost;
    const funding = educationFunding(c.eduBalance || 0, c.eduMonthly || 0, yearsToStart, duration, effCost, c.eduScholarshipYear || 0, g.assumedReturnPct);
    return { c, yearsToStart, duration, funding, usingDefaultCost, effCost };
  });

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
  // picture shows its full calculation. The range is scaled by the
  // confidence score - the less verified data behind a number, the
  // wider its band.
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
  const rangeFor = (value: number): string => {
    const half = Math.max(150, Math.abs(value) * (0.55 - 0.45 * (confidence.score / 100)));
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
            <Text style={styles.rangeLine}>{rangeFor(fed)}</Text>
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
            <Text style={styles.rangeLine}>{rangeFor(st)}</Text>
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
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Retirement Readiness **</Text>
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
              <Pressable style={styles.button} onPress={() => navigation.navigate("Lifestyle")}>
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
            <>
              <Text style={styles.line}>Can this household support the life it wants after work ends?</Text>
              {!adultOutlook.every((a) => a.age === null) && spendingAnnual > 0 && (coveredByDependable ? (
                <>
                  <Text style={styles.line}>{"\u{1F7E2}"} Your dependable income covers the spending target on its own - {money(hhRet.dependableAnnual)}/year of Social Security, pension and other income against a target of {money(spendingAnnual)}/year. Your savings sit on top of that.</Text>
                  <Text style={styles.line}>Projected portfolio at retirement: {money(projectedToday)} in today's dollars.</Text>
                </>
              ) : (
                <>
                  <Text style={styles.line}>Target retirement: {laterYear}</Text>
                  <Text style={styles.line}>Desired lifestyle: {money(spendingAnnual)}/year</Text>
                  <Text style={styles.line}>Social Security: {ssAnnualTotal > 0 ? `${money(ssAnnualTotal)}/year` : "not entered yet"}</Text>
                  <Text style={styles.line}>Pension and other dependable income: {money(pensionAnnualEff + (g.otherRetirementIncomeAnnual || 0))}/year</Text>
                  <Text style={styles.line}>Portfolio needs to fund: {money(hhRet.portfolioGapAnnual)}/year</Text>
                  <Text style={styles.line}>Projected portfolio support: {money(supportAnnual)}/year</Text>
                  <Text style={styles.line}>{supportAnnual - hhRet.portfolioGapAnnual >= 0 ? `Projected surplus: ${money(supportAnnual - hhRet.portfolioGapAnnual)}/year` : `Projected shortfall: ${money(hhRet.portfolioGapAnnual - supportAnnual)}/year`}</Text>
                  {accuracy.level === "X" ? (
                    <>
                      <Text style={styles.line}>This is a fallback estimate, not a verdict. With no spending target of your own and no Social Security or pension entered, HomeTower assumes spending of 70% of income and dependable income of $0 - a very conservative placeholder that makes the target look far larger than it will once the real inputs are in.</Text>
                      <Text style={styles.line}>To personalize it, add: {accuracy.missing.join("; ")} - on the Retirement Lifestyle page (in Plan) and in the {state.intake.name || "My House"} tab.</Text>
                    </>
                  ) : (
                    <>
                      <Text style={styles.line}>{projectedToday >= hhRet.needBase ? "\u{1F7E2} On track as a household at the Balanced 4.0% withdrawal rate." : `\u{1F534} Short by ${money(hhShort)} as a household${hhReqMo > 0 ? ` - saving about ${money(hhReqMo)}/mo more across the household closes it` : ""}.`}</Text>
                      {showSensitivity && <Text style={styles.line}>Working longer, where you marked flexibility, lifts readiness from {readinessPct}% to {delayReadiness}% (the target year moves to {thisYearR + Math.round(projDelay.laterYears)}).</Text>}
                      {accuracy.level === "X+" && accuracy.missing.length > 0 && (
                        <Text style={styles.line}>Still missing: {accuracy.missing.join("; ")} - adding them sharpens this forecast.</Text>
                      )}
                    </>
                  )}
                  <Text style={styles.line}>In future dollars, the {laterYear} target is about {money(futureNeed)}; every figure above is in today's purchasing power.</Text>
                  <Text style={styles.line}>More Safety (3.5%): {money(hhRet.needConservative)} - Balanced (4.0%): {money(hhRet.needBase)} - More Flexible Spending (4.5%): {money(hhRet.needFlexible)}</Text>
                  {phases && (
                    <Text style={styles.line}>Timeline: both working until {phases.y1}; then {phases.earlyName} is retired while {phases.lateName} works, until {phases.y2}; both retired from {phases.y2}.</Text>
                  )}
                  <Text style={styles.line}>Based on a 4.0% starting withdrawal rate (Balanced) and today's purchasing power.</Text>
                </>
              ))}
              {accuracy.level === "X" && spendingAnnual > 0 && (
                <Text style={styles.line}>Rough placeholder: {moneyShort(hhRet.needBase)}* - Based on 70% of current income and assuming $0 Social Security or pension. Do not use for retirement decisions.</Text>
              )}
              {spendingTier === "quick" && (
                <Text style={styles.line}>Spending basis: your quick estimate.</Text>
              )}
              <Pressable onPress={() => setShowAssumptions(!showAssumptions)}>
                <Text style={styles.manualLink}>Forecast assumptions {showAssumptions ? "(hide)" : "(show)"}</Text>
              </Pressable>
              {showAssumptions && (
                <>
                  <Text style={styles.line}>Retirement ages: {adults.map((m) => `${m.name || (m.role === "self" ? "You" : "Spouse")} - ${m.retireAge || 67}`).join(", ")}</Text>
                  <Text style={styles.line}>Annual spending: {money(spendingAnnual)} - today's dollars{spendingFromDefault ? " (70% estimate)" : lifestyleConfirmed ? " (from your Retirement Lifestyle page)" : spendingFromBudget ? " (from your budget)" : ""}</Text>
                  <Text style={styles.line}>Investment return: {g.assumedReturnPct}% - Inflation: {g.inflationPct}%</Text>
                  <Text style={styles.line}>Withdrawal rate: 4.0% (Balanced)</Text>
                  {adults.map((m, i) => (
                    <Text key={m.id} style={styles.line}>Social Security - {m.name || (m.role === "self" ? "You" : "Spouse")}: {ssPerAdult[i].annual > 0 ? (ssPerAdult[i].source === "statement" ? `${money(ssPerAdult[i].annual)}/year (from your Social Security statement)` : `${money(ssPerAdult[i].annual)}/year, claim at ${m.ssClaimAge || 67}`) : "not entered"}</Text>
                  ))}
                  <Text style={styles.line}>Pension: {money(pensionAnnualEff)}/year{pensionFromStatement ? " (from your pension statement)" : ""}</Text>
                  <Text style={styles.line}>Net rental / other dependable: {money(g.otherRetirementIncomeAnnual || 0)}/year</Text>
                  <Text style={styles.line}>Home equity: excluded from the investable portfolio</Text>
                  {phases && <Text style={styles.line}>Bridge years ({phases.y1}-{phases.y2}): the retired spouse's portfolio keeps growing and is not drawn - the working spouse's income covers those years</Text>}
                  <Text style={styles.line}>Healthcare: not included yet</Text>
                  <Text style={styles.line}>Last updated: {updatedLabel}</Text>
                </>
              )}
              {adultOutlook.map((a, i) => (
                <View key={a.m.id} style={styles.personBlock}>
                  <Text style={styles.personName}>{a.m.name || (a.m.role === "self" ? "You" : "Spouse")} - retire at {a.m.retireAge || 67}</Text>
                  {a.age === null ? (
                    <Text style={styles.line}>Add a date of birth in the {state.intake.name || "My House"} tab and HomeTower can time this.</Text>
                  ) : (
                    <Text style={styles.line}>Projected contribution to household retirement: {moneyShort(deflateToToday(projNow.perAtLater[i], projNow.laterYears, g.inflationPct))} by {laterYear} - saving {money(a.mo)}/mo{a.paceFromSlips ? " (pace from payslips)" : ""}.{a.m.retireTarget > 0 ? ` Personal target: ${money(a.m.retireTarget)}.` : ""}</Text>
                  )}
                </View>
              ))}
              {adultOutlook.some((a) => a.paceFromSlips) && k401Totals && (
                <Text style={styles.footnote}>Pace from payslips: {money(k401Totals.total)} contributed in {k401Totals.year} across {k401Totals.earners} earner{k401Totals.earners === 1 ? "" : "s"}. Balances still count as $0 until a 401(k) statement is added - the funded % can only rise from here.</Text>
              )}
            </>
          )}
        </View>
      )}

      {children.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Education - timing and funding, per child **</Text>
          {eduOutlook.map(({ c, yearsToStart, duration, funding, usingDefaultCost }) => {
            const pct = funding.pctFunded ?? 0;
            return (
              <View key={c.id} style={styles.personBlock}>
                <Text style={styles.personName}>🎓 {educationLine(c.name || "Child", c.dob, c.studentNow, c.collegeStartYear, c.yearsLeftInCollege, today)}</Text>
                <View style={styles.tilesRow}>
                  <View style={styles.tile}>
                    <Text numberOfLines={1} style={[styles.tileValue, { color: funding.gap <= 0 ? GREEN : pct >= 70 ? YELLOW : RED }]}>{pct}%</Text>
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
                <Text style={styles.line}>{funding.gap <= 0 ? "🟢 Covered." : yearsToStart > 0 ? `🔴 Gap ${money(funding.gap)} - save ${money(funding.requiredMonthly)}/mo (now ${money(c.eduMonthly || 0)}/mo) to close it.` : `🔴 Gap ${money(funding.gap)} - college is here: cash flow, loans, or a cheaper plan.`}{c.eduScholarshipYear ? ` After a ${money(c.eduScholarshipYear)}/yr scholarship.` : ""}</Text>
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
          <RingGauge pct={confidence.score} label={`Prediction confidence (${confidence.band})`} color={confColor} />
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
          <Text style={styles.actionRow}><Text style={styles.actionKey}>Confidence: </Text>{action.confidence}</Text>
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
            onPress={() => { if (t.target) { setTasksOpen(false); navigation.navigate(t.target); } }}
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
