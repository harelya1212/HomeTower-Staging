// Retirement (round 52, spec section G): the destination behind
// Plan -> Retirement and behind a tap anywhere on the Home
// retirement card. One screen, five destinations, every one of them
// real: Readiness (the full forecast details - the same component
// the Home card expands), Lifestyle (the existing Lifestyle tab),
// Accounts (the Documents tab), Social Security (per-adult status
// with its sources, plus the two ways to act on it: upload a
// statement in Documents, or enter the figure in the household tab),
// Scenarios (the 5/6/7% reach ages, the withdrawal-rate needs, and
// the three action levers with the chosen one badged Recommended -
// never three equal recommendations). Hidden tab like Lifestyle;
// reached with a section param, and the tab stays mounted, so
// returning to Home loses nothing (AC-E6).
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import RetirementDetails from "../components/RetirementDetails.tsx";
import { monthYearLabel } from "../goals.ts";
import { payslip401kTotals, payslipForecast } from "../payslips.ts";
import { computeRetirementModel } from "../retirementModel.ts";
import { setWizardIntent, todayIso, useHousehold, type RetirementSection } from "../store.tsx";
import { money, moneyShort, NAVY, TEAL } from "./HomeScreen.tsx";

type Section = RetirementSection;

export default function RetirementScreen() {
  const { state } = useHousehold();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const today = todayIso();
  const [section, setSection] = useState<Section>("readiness");

  useFocusEffect(
    React.useCallback(() => {
      const wanted = route.params?.section as Section | undefined;
      if (wanted === "readiness" || wanted === "scenarios" || wanted === "social") setSection(wanted);
    }, [route.params]),
  );

  const slipFc = useMemo(
    () => payslipForecast(state.intake.documents, state.family, state.jobs, today),
    [state.intake.documents, state.family, state.jobs, today],
  );
  const k401Totals = useMemo(
    () => payslip401kTotals(state.intake.documents, today, state.jobs),
    [state.intake.documents, today, state.jobs],
  );
  const retAssets = state.assets.filter((a) => a.kind === "401k" || a.kind === "ira");
  const retBalance = retAssets.length ? retAssets.reduce((s, a) => s + a.value, 0) : state.goals.retirementBalance;
  const retMonthly = retAssets.length ? retAssets.reduce((s, a) => s + a.monthly, 0) : state.goals.retirementMonthly;
  const effIncome = slipFc ? slipFc.projectedTaxable : state.grossIncome;
  const model = computeRetirementModel({ state, today, slipFc, k401Totals, retBalance, retMonthly, effIncome, moneyFmt: money });
  const g = state.goals;
  const d = model.directional;
  const houseTab = state.intake.name || "My House";

  const rows: { key: Section | "lifestyle" | "accounts"; icon: string; label: string; hint: string }[] = [
    { key: "readiness", icon: "🎯", label: "Readiness", hint: "The full forecast, with every source" },
    { key: "lifestyle", icon: "🏠", label: "Lifestyle", hint: "What retirement should cost, from your spending" },
    { key: "accounts", icon: "🪙", label: "Accounts", hint: "Statements and documents in Documents" },
    { key: "social", icon: "🏛️", label: "Social Security", hint: "Benefits per person, and where each figure came from" },
    { key: "scenarios", icon: "🔀", label: "Scenarios", hint: "Returns, withdrawal rates, and the one recommended action" },
  ];
  const goRow = (key: (typeof rows)[number]["key"]) => {
    if (key === "lifestyle") navigation.navigate("Lifestyle");
    else if (key === "accounts") navigation.navigate("Documents");
    else setSection(key);
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Retirement</Text>
      <View style={styles.card}>
        {rows.map((r) => (
          <Pressable key={r.key} style={[styles.row, (r.key === section) && styles.rowActive]} onPress={() => goRow(r.key)}>
            <Text style={styles.rowIcon}>{r.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>{r.label}</Text>
              <Text style={styles.rowHint}>{r.hint}</Text>
            </View>
            <Text style={styles.rowChevron}>›</Text>
          </Pressable>
        ))}
      </View>

      {section === "readiness" && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Readiness</Text>
          {model.adults.length === 0 ? (
            <Text style={styles.line}>Add the adults of the household in the {houseTab} tab and HomeTower can build this forecast.</Text>
          ) : model.coveredByDependable ? (
            <>
              <Text style={styles.line}>{"\u{1F7E2}"} On track - dependable income covers the target on its own ({money(model.hhRet.dependableAnnual)}/year).</Text>
              <RetirementDetails model={model} g={g} householdName={state.intake.name} k401Totals={k401Totals} today={today} />
            </>
          ) : d && d.sufficient ? (
            <>
              <Text style={styles.line}>{d.rating === "on_track" ? "\u{1F7E2}" : d.rating === "close" ? "\u{1F7E1}" : d.rating === "needs_improvement" ? "\u{1F7E0}" : "\u{1F534}"} Outlook: {d.ratingLabel}{model.accuracy.level === "X" ? " (early estimate - low confidence)" : ""}</Text>
              <Text style={styles.line}>Desired retirement: Age {d.desiredAge} - Current path: {d.rangeLabel === "80+" ? "80+" : `~${d.rangeLabel}`}</Text>
              {d.action.kind !== "none" && <Text style={styles.line}>Recommended: {d.action.text}</Text>}
              {d.action.impactText !== "" && <Text style={styles.line}>{d.action.impactText}</Text>}
              {model.accuracy.level === "X" && model.personalizeSentence !== "" && <Text style={styles.line}>{model.personalizeSentence}</Text>}
              {model.accuracy.level === "X" && (
                <Pressable style={styles.button} onPress={() => { setWizardIntent(); navigation.navigate("Lifestyle"); }}>
                  <Text style={styles.buttonText}>Complete {model.accuracy.missing.length} retirement inputs</Text>
                </Pressable>
              )}
              <RetirementDetails model={model} g={g} householdName={state.intake.name} k401Totals={k401Totals} today={today} />
            </>
          ) : model.accuracy.level !== "X" && model.spendingAnnual > 0 ? (
            <>
              <Text style={styles.line}>{model.retHeadline} - projected {moneyShort(model.projectedToday)} against a target of {moneyShort(model.hhRet.needBase)} (readiness {model.readinessPct}%).</Text>
              <RetirementDetails model={model} g={g} householdName={state.intake.name} k401Totals={k401Totals} today={today} />
            </>
          ) : (
            <>
              <Text style={styles.line}>Not ready to score yet - HomeTower needs a date of birth and either a balance or a contribution pace before it can draw a path.</Text>
              {model.personalizeSentence !== "" && <Text style={styles.line}>{model.personalizeSentence}</Text>}
              <Pressable style={styles.button} onPress={() => { setWizardIntent(); navigation.navigate("Lifestyle"); }}>
                <Text style={styles.buttonText}>Complete {model.accuracy.missing.length} retirement inputs</Text>
              </Pressable>
            </>
          )}
        </View>
      )}

      {section === "social" && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Social Security</Text>
          {model.adults.map((m, i) => {
            const r = model.ssPerAdult[i];
            const stmt = state.intake.documents.find((doc) => doc.docType === "ssa_statement" && doc.ownerMemberId === m.id);
            return (
              <View key={m.id} style={styles.personBlock}>
                <Text style={styles.personName}>{m.name || (m.role === "self" ? "You" : "Spouse")}</Text>
                {r.annual > 0 && r.source === "manual" && (
                  <Text style={styles.line}>{money(r.annual)}/year - entered by you, claim at {m.ssClaimAge || 67}.</Text>
                )}
                {r.annual > 0 && r.source === "statement" && (
                  <Text style={styles.line}>{money(r.annual)}/year - from your Social Security statement{stmt ? ` (${monthYearLabel(stmt.capturedOn ?? null)})` : ""}, claim at {m.ssClaimAge || 67}.</Text>
                )}
                {r.annual <= 0 && (
                  <Text style={styles.line}>Unknown - no figure entered and no statement on file yet.</Text>
                )}
              </View>
            );
          })}
          <Text style={styles.line}>Two ways to add it: upload the Social Security statement (HomeTower reads the benefit and asks whose it is), or type the yearly figure in the {houseTab} tab.</Text>
          <Pressable style={styles.button} onPress={() => navigation.navigate("Documents")}>
            <Text style={styles.buttonText}>Upload a statement in Documents</Text>
          </Pressable>
          <Pressable style={styles.buttonSecondary} onPress={() => navigation.navigate("MyHouse")}>
            <Text style={styles.buttonSecondaryText}>Enter or edit it in {houseTab}</Text>
          </Pressable>
        </View>
      )}

      {section === "scenarios" && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Scenarios</Text>
          {d && d.sufficient ? (
            <>
              <Text style={styles.line}>Desired retirement: Age {d.desiredAge}. Current path: {d.rangeLabel === "80+" ? "80+" : `~${d.rangeLabel}`}.</Text>
              <Text style={styles.line}>Goal reached at {d.reach.r7 === null ? "not by 80" : `age ${d.reach.r7}`} with 7% returns (Higher Growth), {d.reach.r6 === null ? "not by 80" : `age ${d.reach.r6}`} at 6% (Balanced), {d.reach.r5 === null ? "not by 80" : `age ${d.reach.r5}`} at 5% (More Safety). Inflation {g.inflationPct}% throughout; every figure in today's dollars.</Text>
              <Text style={styles.line}>Required portfolio at the Balanced 4.0% withdrawal rate: {money(d.requiredPortfolio)}{model.spendingTier === "none" ? " (placeholder spending basis - 70% of income)" : ""}. Projected assets by the desired age: {money(d.projectedAtDesired)}. Gap: {money(d.gapAtDesired)}.</Text>
              <Text style={styles.line}>Withdrawal-rate sensitivity (portfolio needed): More Safety 3.5% - {money(model.hhRet.needConservative)}; Balanced 4.0% - {money(model.hhRet.needBase)}; More Flexible 4.5% - {money(model.hhRet.needFlexible)}.</Text>
              {model.showSensitivity && <Text style={styles.line}>Working longer, where flexibility is marked, lifts readiness from {model.readinessPct}% to {model.delayReadiness}%.</Text>}
              <Text style={styles.subhead}>The three levers</Text>
              <Text style={styles.line}>Save more: {d.levers.saveMonthly === null ? "even $20,000/month more does not reach the desired age on its own" : d.levers.saveMonthly === 0 ? "no extra saving needed" : `about ${money(d.levers.saveMonthly)}/month more reaches it`}{d.action.kind === "save" ? " - Recommended" : ""}</Text>
              <Text style={styles.line}>Retire later: {d.levers.yearsLater === null ? "the base scenario does not reach by 80" : `retiring at ${d.reach.r6} (${d.levers.yearsLater} year${d.levers.yearsLater === 1 ? "" : "s"} later) reaches it`}{d.action.kind === "delay" ? " - Recommended" : ""}</Text>
              <Text style={styles.line}>Spend less: {d.levers.spendingCutAnnual > 0 ? `about ${money(d.levers.spendingCutAnnual)}/year less in retirement closes the gap` : "no gap to close"}{d.action.kind === "spend" ? " - Recommended" : ""}</Text>
              {d.action.kind === "combo" && <Text style={styles.line}>Combination - Recommended: {d.action.text}. {d.action.impactText}</Text>}
              {d.action.kind === "none" && <Text style={styles.line}>Recommended: {d.action.text}.</Text>}
              <Text style={styles.line}>Only one action is recommended - the first lever that plausibly closes the gap on its own (saving under 10% of monthly net, a delay of up to 2 years, or a spending cut under 10% of the target); otherwise the combination.</Text>
            </>
          ) : (
            <Text style={styles.line}>Not enough data for scenarios yet - add a retirement age, and either a balance or a contribution pace, and the three scenarios appear here.</Text>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F4F7FA" },
  content: { padding: 16, paddingBottom: 40 },
  title: { fontSize: 26, fontWeight: "800", color: NAVY, marginBottom: 12 },
  card: { backgroundColor: "#FFFFFF", borderRadius: 14, padding: 16, marginBottom: 14, shadowColor: "#0B2A4A", shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  cardLabel: { fontSize: 13, fontWeight: "700", color: TEAL, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#E3EAF2" },
  rowActive: { backgroundColor: "#EEF4F8", borderRadius: 8 },
  rowIcon: { fontSize: 22, marginRight: 12 },
  rowLabel: { fontSize: 17, fontWeight: "700", color: NAVY },
  rowHint: { fontSize: 13, color: "#5A6B7D", marginTop: 2 },
  rowChevron: { fontSize: 22, color: TEAL, fontWeight: "700" },
  line: { fontSize: 15, color: NAVY, marginTop: 6, lineHeight: 21 },
  subhead: { fontSize: 16, fontWeight: "700", color: NAVY, marginTop: 14 },
  personBlock: { marginTop: 12, borderTopWidth: 1, borderTopColor: "#E3EAF2", paddingTop: 10 },
  personName: { fontSize: 16, fontWeight: "700", color: NAVY },
  button: { backgroundColor: TEAL, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14, marginTop: 12, alignItems: "center" },
  buttonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  buttonSecondary: { borderWidth: 1, borderColor: TEAL, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14, marginTop: 10, alignItems: "center" },
  buttonSecondaryText: { color: TEAL, fontSize: 15, fontWeight: "700" },
});
