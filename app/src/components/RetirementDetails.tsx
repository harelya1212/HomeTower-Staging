// The full retirement forecast details, shared by the Home card's
// "View details" expansion and the Retirement screen's Readiness
// section (round 52) - one component, one model (retirementModel.ts),
// so the two surfaces can never tell different stories. Round 52
// adds the directional scenario block at accuracy X and source
// labels on every value (spec AC-D5): Social Security unknown is
// "Unknown", never a silent blank, and employer match carries its
// provenance - payslip, statement, or an honest Not detected.
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { deflateToToday, monthYearLabel, ratingColorKey } from "../goals.ts";
import { dateLabel } from "../reconcile.ts";
import RetirementTimeline from "./RetirementTimeline.tsx";
import type { Payslip401k } from "../payslips.ts";
import type { RetirementModel } from "../retirementModel.ts";
import type { GoalInputs } from "../store.tsx";
import { money, moneyShort } from "../screens/HomeScreen.tsx";

// Same palette as HomeScreen, declared locally: this component is
// imported BY HomeScreen, and a StyleSheet evaluated at module init
// must never read a cyclic import that may not have initialized.
const NAVY = "#0B2A4A";
const TEAL = "#0E7C86";

const reachText = (age: number | null) => (age === null ? "not by 80" : `age ${age}`);

export default function RetirementDetails({ model, g, householdName, k401Totals, today }: {
  model: RetirementModel;
  g: GoalInputs;
  householdName: string;
  k401Totals: Payslip401k | null;
  today: string;
}) {
  const [showAssumptions, setShowAssumptions] = useState(false);
  const {
    adults, adultOutlook, spendingAnnual, ssPerAdult, ssAnnualTotal, pensionAnnualEff,
    pensionFromStatement, pensionKnown, projectedToday, laterYear, hhRet, readinessPct,
    hhShort, hhReqMo, accuracy, projNow, projDelay, delayReadiness, showSensitivity,
    futureNeed, supportAnnual, coveredByDependable, spendingTier, spendingFromDefault,
    lifestyleConfirmed, spendingFromBudget, phases, updatedLabel, directional,
  } = model;
  const thisYearR = Number(today.slice(0, 4));
  const houseTab = householdName || "My House";
  return (
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
          <Text style={styles.line}>Desired lifestyle: {money(spendingAnnual)}/year{spendingTier === "none" ? " (placeholder - 70% of income, not a target you set)" : spendingTier === "quick" ? " (your quick estimate)" : lifestyleConfirmed ? " (your confirmed lifestyle target)" : ""}</Text>
          <Text style={styles.line}>Social Security: {ssAnnualTotal > 0 ? `${money(ssAnnualTotal)}/year` : "Unknown - not entered yet"}</Text>
          <Text style={styles.line}>Pension and other dependable income: {money(pensionAnnualEff + (g.otherRetirementIncomeAnnual || 0))}/year{pensionKnown && pensionAnnualEff <= 0 && (g.otherRetirementIncomeAnnual || 0) <= 0 ? " (you told HomeTower there is no pension)" : pensionFromStatement ? " (from your pension statement)" : pensionAnnualEff > 0 ? " (entered by you)" : " - pension unknown"}</Text>
          <Text style={styles.line}>Portfolio needs to fund: {money(hhRet.portfolioGapAnnual)}/year</Text>
          <Text style={styles.line}>Projected portfolio support: {money(supportAnnual)}/year</Text>
          <Text style={styles.line}>{supportAnnual - hhRet.portfolioGapAnnual >= 0 ? `Projected surplus: ${money(supportAnnual - hhRet.portfolioGapAnnual)}/year` : `Projected shortfall: ${money(hhRet.portfolioGapAnnual - supportAnnual)}/year`}</Text>
          {accuracy.level === "X" ? (
            <>
              <Text style={styles.line}>This is a fallback estimate, not a verdict. With no spending target of your own and no Social Security or pension entered, HomeTower assumes spending of 70% of income and dependable income of $0 - a very conservative placeholder that makes the target look far larger than it will once the real inputs are in.</Text>
              <Text style={styles.line}>To personalize it, add: {accuracy.missing.join("; ")} - on the Retirement Lifestyle page (in Plan) and in the {houseTab} tab.</Text>
              {directional && directional.sufficient && (
                <>
                  <Text style={styles.line}>Directional outlook (low confidence, placeholder basis): desired retirement age {directional.desiredAge}; the goal is reached at {reachText(directional.reach.r7)} with 7% returns, {reachText(directional.reach.r6)} at 6%, {reachText(directional.reach.r5)} at 5% - current path {directional.rangeLabel}.</Text>
                  <Text style={styles.line}>Required portfolio (today's dollars, placeholder spending): {money(directional.requiredPortfolio)}. Projected assets by the desired age: {money(directional.projectedAtDesired)}. Gap at the desired age: {money(directional.gapAtDesired)}.</Text>
                  <Text style={styles.line}>The age range may change significantly once your real spending, Social Security and pension are in - it is a direction, not a verdict.</Text>
                </>
              )}
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
      {directional && directional.sufficient && model.timeline && (
        <>
          <Text style={styles.subhead}>Retirement timeline</Text>
          <RetirementTimeline timeline={model.timeline} colorKey={ratingColorKey(directional.rating)} />
        </>
      )}
      {spendingTier === "quick" && (
        // ROUND 62 (R62-3): the quick-estimate target is a
        // PLANNING estimate - it must never read as if its
        // unknowns (Social Security above all) were confirmed
        // zeros, so the missing components are named right here.
        <Text style={styles.line}>Spending basis: your quick estimate. The {moneyShort(hhRet.needBase)} target is a planning estimate, not a confirmed forecast - it does not assume Social Security or a pension is $0; those are simply not in yet. Still missing: {accuracy.missing.length ? accuracy.missing.join("; ") : "nothing major"}.</Text>
      )}
      <Pressable onPress={() => setShowAssumptions(!showAssumptions)}>
        <Text style={styles.manualLink}>Forecast assumptions {showAssumptions ? "(hide)" : "(show)"}</Text>
      </Pressable>
      {showAssumptions && (
        <>
          <Text style={styles.line}>Retirement ages: {adults.map((m) => `${m.name || (m.role === "self" ? "You" : "Spouse")} - ${m.retireAge || 67}`).join(", ")}</Text>
          <Text style={styles.line}>Annual spending: {money(spendingAnnual)} - today's dollars{spendingFromDefault ? " (70% estimate)" : lifestyleConfirmed ? " (from your Retirement Lifestyle page)" : spendingTier === "quick" ? " (your quick estimate)" : spendingFromBudget ? " (from your budget)" : ""}</Text>
          <Text style={styles.line}>Investment return: {g.assumedReturnPct}% - Inflation: {g.inflationPct}%</Text>
          <Text style={styles.line}>Withdrawal rate: 4.0% (Balanced)</Text>
          {adults.map((m, i) => (
            <Text key={m.id} style={styles.line}>Social Security - {m.name || (m.role === "self" ? "You" : "Spouse")}: {ssPerAdult[i].annual > 0 ? (ssPerAdult[i].source === "statement" ? `${money(ssPerAdult[i].annual)}/year (from your Social Security statement)` : `${money(ssPerAdult[i].annual)}/year, claim at ${m.ssClaimAge || 67}`) : "Unknown - not entered yet"}</Text>
          ))}
          <Text style={styles.line}>Pension: {pensionAnnualEff > 0 ? `${money(pensionAnnualEff)}/year${pensionFromStatement ? " (from your pension statement)" : " (entered by you)"}` : pensionKnown ? "$0/year (you told HomeTower there is no pension)" : "Unknown - not entered yet"}</Text>
          {adultOutlook.map((a) => {
            const who = a.m.name || (a.m.role === "self" ? "You" : "Spouse");
            if (a.matchMo > 0 && a.matchRes.status === "from_statement" && a.stmtMatch) {
              // ROUND 60 (P2): the same provenance family as the
              // Documents 401(k) card (round 59, trace E) - the
              // statement CONFIRMS the year-to-date total; the
              // monthly pace is derived from its period and is
              // labelled as derived, never presented as a figure
              // the statement stated.
              const sm = a.stmtMatch;
              return (
                <View key={`match-${a.m.id}`}>
                  <Text style={styles.line}>Employer contributions YTD ({who}): {money(sm.periodTotal)} confirmed</Text>
                  <Text style={styles.line}>Estimated monthly pace: ~{money(a.matchMo)}/mo</Text>
                  <Text style={styles.line}>Derived from {sm.periodLabel ? `the ${sm.periodLabel} statement period` : sm.months ? `the statement's ${sm.months}-month period` : "the statement period"} - the statement confirms the year-to-date total; it does not state a monthly figure.</Text>
                </View>
              );
            }
            if (a.matchMo > 0) {
              return <Text key={`match-${a.m.id}`} style={styles.line}>Employer match ({who}): {money(a.matchMo)}/mo (from your payslips)</Text>;
            }
            if (a.matchRes.detectedNotPaced && a.stmtMatch) {
              return <Text key={`match-${a.m.id}`} style={styles.line}>Employer match ({who}): {money(a.stmtMatch.periodTotal)} on your 401(k) statement ({monthYearLabel(a.matchRes.statementOn)}) - the statement does not state its period, so no monthly pace is counted yet.</Text>;
            }
            if (a.matchRes.status === "not_detected") {
              return <Text key={`match-${a.m.id}`} style={styles.line}>Employer match ({who}): Not detected on your payslips - add a 401(k) statement and HomeTower will read it from there.</Text>;
            }
            if (a.matchRes.status === "unknown") {
              return <Text key={`match-${a.m.id}`} style={styles.line}>Employer match ({who}): Unknown - no payslip or 401(k) statement on file yet.</Text>;
            }
            return null;
          })}
          {adultOutlook.map((a) => (a.stmt401k ? (
            <Text key={`stmt401k-${a.m.id}`} style={styles.line}>{a.m.name || (a.m.role === "self" ? "You" : "Spouse")} - 401(k) balance from your statement ({monthYearLabel(a.stmt401k.capturedOn)}): {money(a.stmt401k.balance)}</Text>
          ) : null))}
          {adultOutlook.map((a) => {
            const f = a.facts;
            if (!f) return null;
            const who = a.m.name || (a.m.role === "self" ? "You" : "Spouse");
            const prov = `401(k) statement, period ending ${dateLabel(f.statementAsOf ?? f.capturedOn ?? "")}`;
            return (
              <View key={`facts-${a.m.id}`}>
                {(f.pretaxRothYtd !== null || f.afterTaxYtd !== null || f.matchYtd !== null || f.total415Ytd !== null) && (
                  <Text style={styles.line}>{who} - contributions this year ({prov}):{f.pretaxRothYtd !== null ? ` pre-tax/Roth ${money(f.pretaxRothYtd)}` : ""}{f.afterTaxYtd !== null ? ` - after-tax ${money(f.afterTaxYtd)}` : ""}{f.matchYtd !== null ? ` - employer match ${money(f.matchYtd)}` : ""}{f.total415Ytd !== null ? ` - total ${money(f.total415Ytd)}` : ""}. The statement confirms the year's totals; the monthly pace comes from the freshest regular payslip.</Text>
                )}
                {(f.pretaxBalance !== null || f.matchBalance !== null || f.rothConversionBalance !== null || f.afterTaxBalance !== null) && (
                  <Text style={styles.line}>{who} - 401(k) balance mix ({prov}):{f.pretaxBalance !== null ? ` pre-tax ${money(f.pretaxBalance)}` : ""}{f.matchBalance !== null ? ` - employer match ${money(f.matchBalance)}` : ""}{f.rothConversionBalance !== null ? ` - Roth conversions ${money(f.rothConversionBalance)}` : ""}{f.afterTaxBalance !== null ? ` - after-tax ${money(f.afterTaxBalance)}` : ""}</Text>
                )}
                {(f.afterTaxYtd !== null || f.rothConversionBalance !== null || f.afterTaxBalance !== null) && (
                  <Text style={styles.line}>{who} - Mega Backdoor Roth ({prov}):{f.afterTaxYtd !== null ? ` after-tax contributions ${money(f.afterTaxYtd)} this year` : ""}{f.rothConversionBalance !== null ? ` - Roth in-plan conversion balance ${money(f.rothConversionBalance)}` : ""}{f.afterTaxBalance !== null ? ` - after-tax balance still unconverted ${money(f.afterTaxBalance)}${f.afterTaxBalance === 0 ? " (the statement prints $0.00 - a confirmed zero)" : ""}` : ""}</Text>
                )}
                {f.holdings.map((h) => (
                  <Text key={h.label} style={styles.line}>{who} - invested in: {h.label} - {money(h.value)} ({prov})</Text>
                ))}
                {f.election && <Text style={styles.line}>{who} - future contributions: {f.election} (current election, per the statement)</Text>}
              </View>
            );
          })}
          <Text style={styles.line}>Net rental / other dependable: {money(g.otherRetirementIncomeAnnual || 0)}/year</Text>
          <Text style={styles.line}>Home equity: excluded from the investable portfolio</Text>
          {phases && model.bridge && (
            <Text style={styles.line}>Bridge years ({phases.y1}-{phases.y2}): {phases.earlyName} is retired while {phases.lateName} works. Computed bridge: needs of {money(model.bridge.needsAnnual)}/yr (spending {money(model.bridge.spendingAnnual)} + healthcare {money(model.bridge.healthcareAnnual)} + taxes {money(model.bridge.taxesAnnual)} + debt service {money(model.bridge.debtServiceAnnual)}) against {money(model.bridge.workingSpouseNetAnnual)}/yr of {phases.lateName}&apos;s income after withholding plus {money(model.bridge.dependableAnnual)}/yr of dependable income - {model.bridge.covered ? "the gap is $0/yr, so the portfolio is not drawn during the bridge." : `a gap of ${money(model.bridge.gapAnnual)}/yr, drawn from the portfolio during the bridge years; the projected portfolio above is already net of that draw.`}</Text>
          )}
          <Text style={styles.line}>Healthcare: not included yet</Text>
          <Text style={styles.line}>Last updated: {updatedLabel}</Text>
        </>
      )}
      {adultOutlook.map((a, i) => (
        <View key={a.m.id} style={styles.personBlock}>
          <Text style={styles.personName}>{a.m.name || (a.m.role === "self" ? "You" : "Spouse")} - retire at {a.m.retireAge || 67}</Text>
          {a.age === null ? (
            <Text style={styles.line}>Add a date of birth in the {houseTab} tab and HomeTower can time this.</Text>
          ) : (
            <Text style={styles.line}>Projected contribution to household retirement: {moneyShort(deflateToToday(projNow.perAtLater[i], projNow.laterYears, g.inflationPct))} by {laterYear} - saving {money(a.mo)}/mo{a.paceFromSlips ? " (pace from payslips)" : ""}.{a.m.retireTarget > 0 ? ` Personal target: ${money(a.m.retireTarget)}.` : ""}</Text>
          )}
        </View>
      ))}
      {adultOutlook.some((a) => a.paceFromSlips) && k401Totals && !adultOutlook.some((a) => a.stmt401k) && (
        <Text style={styles.footnote}>Pace from payslips: {money(k401Totals.total)} contributed in {k401Totals.year} across {k401Totals.earners} earner{k401Totals.earners === 1 ? "" : "s"}. Balances still count as $0 until a 401(k) statement is added - the funded % can only rise from here.</Text>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  line: { fontSize: 15, color: NAVY, marginTop: 6, lineHeight: 21 },
  subhead: { fontSize: 16, fontWeight: "800", color: NAVY, marginTop: 12 },
  manualLink: { fontSize: 15, color: TEAL, fontWeight: "700", marginTop: 10 },
  personBlock: { marginTop: 12, borderTopWidth: 1, borderTopColor: "#E3EAF2", paddingTop: 10 },
  personName: { fontSize: 16, fontWeight: "700", color: NAVY },
  footnote: { fontSize: 13, color: "#5A6B7D", marginTop: 10, lineHeight: 18 },
});
