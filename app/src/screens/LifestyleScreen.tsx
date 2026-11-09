// Retirement Lifestyle (round 48): the household's retirement
// target built from what it actually spends - not a percentage of
// income. Copilot's expense-based method, in three buckets:
// lifestyle spending that continues / ends / changes, with savings
// contributions and work costs kept OUT of lifestyle spending
// (they are the core reason the 70%-of-gross fallback inflates
// the target). Bank and card statement CSVs uploaded in Documents
// arrive here as spending evidence: they prefill empty categories
// only, and the confirmed breakdown becomes Home's top spending
// source. Every figure is in today's dollars.
import { useNavigation } from "@react-navigation/native";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { TextField } from "../components/Fields.tsx";
import { GREEN, RED } from "../components/Gauge.tsx";
import {
  householdRetirement,
  lifestyleBreakdown,
  LIFESTYLE_GROUP1,
  LIFESTYLE_GROUP2,
  type LifestyleCategory,
  type LifestyleCategoryState,
} from "../goals.ts";
import { payslip401kTotals } from "../payslips.ts";
import { todayIso, useHousehold, type LifestyleState } from "../store.tsx";
import { money, moneyShort, NAVY, TEAL } from "./HomeScreen.tsx";

const num = (v: string) => Number(v.replace(/[^0-9.]/g, "")) || 0;

function AmountInput({ value, onChange, placeholder }: { value: number; onChange: (v: number) => void; placeholder?: string }) {
  return (
    <TextField
      value={value ? String(value) : ""}
      onChange={(v) => onChange(num(v))}
      keyboardType="numeric"
      placeholder={placeholder ?? "0"}
    />
  );
}

export default function LifestyleScreen() {
  const { state, loaded, update, updateGoals } = useHousehold();
  const navigation = useNavigation<any>();
  const today = todayIso();
  const g = state.goals;
  const life = g.lifestyle;
  const adults = state.family.filter((m) => m.role === "self" || m.role === "spouse");

  const k401Totals = useMemo(
    () => payslip401kTotals(state.intake.documents, today, state.jobs),
    [state.intake.documents, today, state.jobs],
  );
  const pace401kAnnual = k401Totals ? Math.round(k401Totals.perEarner.reduce((s, e) => s + (e.monthlyPace ?? 0), 0) * 12) : 0;

  // --- Spending evidence from statement documents -----------------
  const stmtDocs = state.intake.documents.filter((d) => d.docType === "bank_statement" || d.docType === "card_statement");
  const coverageMonths = Math.min(12, stmtDocs.reduce((s, d) => s + (d.spendingSummary?.months ?? 1), 0));
  // Annualized category evidence: a months-weighted average across
  // statement summaries (each summary is already annualized from
  // its own span, so a 12-month file outweighs a 1-month file -
  // summing them would multiply-count the same spending).
  const evidence = useMemo(() => {
    const weighted: Record<string, number> = {};
    let monthsTotal = 0;
    for (const d of stmtDocs) {
      const s = d.spendingSummary;
      if (!s) continue;
      monthsTotal += s.months;
      for (const [k, v] of Object.entries(s.byCategory)) weighted[k] = (weighted[k] ?? 0) + v * s.months;
    }
    const out: Record<string, number> = {};
    if (monthsTotal > 0) for (const [k, v] of Object.entries(weighted)) out[k] = Math.round(v / monthsTotal);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.intake.documents]);

  // --- One-time prefills ------------------------------------------
  // The budget worksheet (My House) seeds the matching categories
  // ONCE, only into a lifestyle store the user has not touched; the
  // payslip 401(k) pace fills its own slot whenever it is empty.
  // Prefills are ordinary editable amounts afterwards.
  const didPrefill = useRef(false);
  useEffect(() => {
    if (!loaded || didPrefill.current) return;
    didPrefill.current = true;
    const untouched = Object.values(life.amounts).every((v) => !(v > 0)) && !life.confirmed && !(life.additionsAnnual > 0);
    const amounts = { ...life.amounts };
    let changed = false;
    if (untouched) {
      const b = g.retirementBudget;
      const seed: Record<string, number> = { housing: b.housing || 0, food: b.food || 0, healthcare: b.healthcare || 0, travel: b.travel || 0, other: b.other || 0 };
      for (const [k, v] of Object.entries(seed)) {
        if (v > 0 && !(amounts[k] > 0)) { amounts[k] = v; changed = true; }
      }
    }
    if (pace401kAnnual > 0 && !(amounts["k401"] > 0)) { amounts["k401"] = pace401kAnnual; changed = true; }
    if (changed) updateGoals({ lifestyle: { ...life, amounts, confirmed: false } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // --- Edits (any edit un-confirms the target) ---------------------
  const editLife = (patch: Partial<LifestyleState>) => updateGoals({ lifestyle: { ...life, ...patch, confirmed: false } });
  const setAmount = (key: string, v: number) => editLife({ amounts: { ...life.amounts, [key]: v } });
  const setAdjusted = (key: string, v: number) => editLife({ adjusted: { ...life.adjusted, [key]: v } });
  const setCatState = (key: string, st: LifestyleCategoryState) => {
    const adjusted = { ...life.adjusted };
    if (st === "changes" && adjusted[key] === undefined) adjusted[key] = life.amounts[key] || 0;
    editLife({ states: { ...life.states, [key]: st }, adjusted });
  };
  const patchMember = (id: string, patch: Record<string, number>) =>
    update({ family: state.family.map((m) => (m.id === id ? { ...m, ...patch } : m)) });

  // --- The computation ---------------------------------------------
  const bd = lifestyleBreakdown(life);
  const ssTotal = adults.reduce((s, m) => s + (m.ssAnnual || 0), 0);
  const pensionStmtMonthly = state.intake.documents.reduce((best, d) => {
    if (d.docType !== "pension_statement" || !d.fields) return best;
    const v = Number(String(d.fields["monthly_benefit"] ?? "").replace(/[^0-9.]/g, ""));
    return Number.isFinite(v) && v > best ? v : best;
  }, 0);
  const memberPension = adults.reduce((s, m) => s + (m.pensionAnnual || 0), 0);
  const pensionAnnualEff = memberPension > 0 ? memberPension : g.pensionAnnual > 0 ? g.pensionAnnual : Math.round(pensionStmtMonthly * 12);
  const hh = householdRetirement({
    spendingAnnual: bd.lifestyleAnnual,
    socialSecurityAnnual: ssTotal,
    pensionAnnual: pensionAnnualEff,
    otherAnnual: g.otherRetirementIncomeAnnual || 0,
    projectedPortfolio: 0,
  });
  const anyAmount = Object.values(life.amounts).some((v) => v > 0) || life.additionsAnnual > 0;

  const wasConfirmed = useRef(false);
  useEffect(() => { if (life.confirmed) wasConfirmed.current = true; }, [life.confirmed]);

  // --- Statement evidence apply ------------------------------------
  const [applyOpen, setApplyOpen] = useState(false);
  const fillable = LIFESTYLE_GROUP1.filter((c) => (evidence[c.key] ?? 0) > 0 && !(life.amounts[c.key] > 0));
  const applyEvidence = () => {
    const amounts = { ...life.amounts };
    for (const c of fillable) amounts[c.key] = evidence[c.key];
    editLife({ amounts });
    setApplyOpen(false);
  };

  if (!loaded) return <View style={styles.screen}><Text style={styles.pad}>Loading...</Text></View>;

  const wfMax = Math.max(bd.currentSpending, bd.lifestyleAnnual, 1);
  const covMax = Math.max(bd.lifestyleAnnual, hh.dependableAnnual, hh.portfolioGapAnnual, 1);
  const wfBar = (label: string, display: string, value: number, scale: number, color: string, bold = false) => (
    <View key={label} style={styles.wfRow}>
      <View style={styles.wfHead}>
        <Text style={[styles.wfLabel, bold && styles.wfBold]}>{label}</Text>
        <Text style={[styles.wfValue, bold && styles.wfBold]}>{display}</Text>
      </View>
      <View style={styles.wfTrack}>
        <View style={[styles.wfFill, { width: `${Math.max(0, Math.min(100, (Math.abs(value) / scale) * 100))}%`, backgroundColor: color }]} />
      </View>
    </View>
  );

  const catRow = (c: LifestyleCategory) => {
    const st = life.states[c.key] ?? "continues";
    const ev = evidence[c.key] ?? 0;
    return (
      <View key={c.key} style={styles.catRow}>
        <View style={styles.catHead}>
          <Text style={styles.catName}>{c.label}</Text>
          <View style={styles.catInput}>
            <AmountInput value={life.amounts[c.key] || 0} onChange={(v) => setAmount(c.key, v)} />
          </View>
        </View>
        <View style={styles.chips}>
          {(["continues", "ends", "changes"] as const).map((s) => (
            <Pressable key={s} style={[styles.chip, st === s && styles.chipOn]} onPress={() => setCatState(c.key, s)}>
              <Text style={[styles.chipText, st === s && styles.chipTextOn]}>{s === "continues" ? "Continues" : s === "ends" ? "Ends" : "Changes"}</Text>
            </Pressable>
          ))}
        </View>
        {st === "changes" && (
          <View style={styles.adjRow}>
            <Text style={styles.adjLabel}>In retirement, per year ($)</Text>
            <View style={styles.catInput}>
              <AmountInput value={life.adjusted[c.key] ?? life.amounts[c.key] ?? 0} onChange={(v) => setAdjusted(c.key, v)} />
            </View>
          </View>
        )}
        {ev > 0 && !(life.amounts[c.key] > 0) && (
          <Text style={styles.evHint}>Your statements suggest about {money(ev)}/yr here - Apply above fills it.</Text>
        )}
      </View>
    );
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Retirement Lifestyle</Text>
      <Text style={styles.purpose}>Your retirement target, built from what your household actually spends - not a percentage of income.</Text>

      <View style={styles.card}>
        <Text style={styles.section}>Spending evidence</Text>
        <Text style={styles.line}>Spending evidence: {coverageMonths} of 12 months</Text>
        <View style={styles.meterTrack}>
          <View style={[styles.meterFill, { width: `${(coverageMonths / 12) * 100}%` }]} />
        </View>
        <Text style={styles.note}>
          {coverageMonths >= 12
            ? "A full year of statements backs the spending below."
            : coverageMonths > 0
              ? "Statements on file cover part of the year - more months make the evidence stronger."
              : "No statements yet - the figures below can be typed, or read from statements you upload."}
        </Text>
        {fillable.length > 0 && !applyOpen && (
          <Pressable style={styles.button} onPress={() => setApplyOpen(true)}>
            <Text style={styles.buttonText}>From your statements (tap to apply)</Text>
          </Pressable>
        )}
        {fillable.length > 0 && applyOpen && (
          <>
            <Text style={styles.line}>This fills {fillable.length} empty {fillable.length === 1 ? "category" : "categories"} from your statements: {fillable.map((c) => c.label).join(", ")}. Categories you already filled are never overwritten, and the amounts stay unconfirmed until you confirm the target below.</Text>
            <View style={styles.rowButtons}>
              <Pressable style={[styles.button, { flex: 1 }]} onPress={applyEvidence}>
                <Text style={styles.buttonText}>Apply statement amounts</Text>
              </Pressable>
              <Pressable style={[styles.buttonAlt, { flex: 0.6 }]} onPress={() => setApplyOpen(false)}>
                <Text style={styles.buttonText}>Not now</Text>
              </Pressable>
            </View>
          </>
        )}
        <Pressable style={styles.buttonAlt} onPress={() => navigation.navigate("Documents")}>
          <Text style={styles.buttonText}>Upload a statement in Documents</Text>
        </Pressable>
        <Text style={styles.note}>Upload bank or card statements in Documents - HomeTower reads the spending from them.</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.section}>Lifestyle spending</Text>
        <Text style={styles.note}>What the household spends today, per year. For each one: does it continue into retirement, end, or change?</Text>
        {LIFESTYLE_GROUP1.map(catRow)}
        <View style={styles.catRow}>
          <View style={styles.catHead}>
            <Text style={styles.catName}>Retirement-only additions</Text>
            <View style={styles.catInput}>
              <AmountInput value={life.additionsAnnual} onChange={(v) => editLife({ additionsAnnual: v })} />
            </View>
          </View>
          <Text style={styles.note}>Spending retirement adds that today does not have - extra travel, a healthcare top-up.</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.section}>Savings & work costs - not lifestyle spending</Text>
        <Text style={styles.note}>Real money out the door today, but not a retirement lifestyle: these end when work ends, and counting them is what makes a percentage-of-income target balloon.</Text>
        {pace401kAnnual > 0 && (
          <Text style={styles.note}>401(k) contributions are prefilled from your payslips (about {money(pace401kAnnual)}/yr across earners) - edit any figure that differs.</Text>
        )}
        {LIFESTYLE_GROUP2.map((c) => (
          <View key={c.key} style={styles.catRow}>
            <View style={styles.catHead}>
              <Text style={[styles.catName, styles.muted]}>{c.label}</Text>
              <View style={styles.endsBadge}><Text style={styles.endsBadgeText}>Ends</Text></View>
              <View style={styles.catInput}>
                <AmountInput value={life.amounts[c.key] || 0} onChange={(v) => setAmount(c.key, v)} />
              </View>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.section}>How the target is built</Text>
        {bd.currentSpending > 0 ? (
          <>
            {wfBar("Current household spending", money(bd.currentSpending), bd.currentSpending, wfMax, NAVY)}
            {wfBar("Expenses that end", `- ${money(bd.endingTotal)}`, bd.endingTotal, wfMax, RED)}
            {wfBar("Changes in retirement", `${bd.changesDelta < 0 ? "- " : bd.changesDelta > 0 ? "+ " : ""}${money(Math.abs(bd.changesDelta))}`, bd.changesDelta, wfMax, bd.changesDelta > 0 ? RED : GREEN)}
            {wfBar("Retirement-only additions", `+ ${money(bd.additions)}`, bd.additions, wfMax, GREEN)}
            {wfBar("Retirement lifestyle target", money(bd.lifestyleAnnual), bd.lifestyleAnnual, wfMax, NAVY, true)}
            {wfBar("Covered by Social Security & reliable income", money(hh.dependableAnnual), hh.dependableAnnual, covMax, TEAL)}
            {wfBar("Portfolio needs to provide", `${money(hh.portfolioGapAnnual)}/yr`, hh.portfolioGapAnnual, covMax, NAVY, true)}
          </>
        ) : (
          <Text style={styles.line}>Add what the household spends today and HomeTower builds the target here, step by step.</Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.section}>Social Security & reliable income</Text>
        <Text style={styles.note}>The same figures as My House - one shared record, edited wherever you are.</Text>
        {adults.map((m) => (
          <View key={m.id} style={styles.personBlock}>
            <Text style={styles.personName}>{m.name || (m.role === "self" ? "You" : "Spouse")}</Text>
            <Text style={styles.label}>Expected Social Security ($ per year)</Text>
            <AmountInput value={m.ssAnnual || 0} onChange={(v) => patchMember(m.id, { ssAnnual: v })} placeholder="From your Social Security statement" />
            <Text style={styles.label}>Pension ($ per year, this person)</Text>
            <AmountInput value={m.pensionAnnual || 0} onChange={(v) => patchMember(m.id, { pensionAnnual: v })} placeholder="Or let a pension statement in Documents speak" />
          </View>
        ))}
        {memberPension <= 0 && pensionAnnualEff > 0 && (
          <Text style={styles.note}>Pension of {money(pensionAnnualEff)}/yr is already on file from your pension statement - it counts below.</Text>
        )}
        <Text style={styles.label}>Other dependable income ($ per year - net rent, annuities)</Text>
        <AmountInput value={g.otherRetirementIncomeAnnual || 0} onChange={(v) => updateGoals({ otherRetirementIncomeAnnual: v })} placeholder="You can set this later" />
        <View style={styles.toggleRow}>
          <Text style={[styles.label, { flex: 1 }]}>This household has no pension</Text>
          <Switch value={g.noPension} onValueChange={(v) => updateGoals({ noPension: v })} />
        </View>
      </View>

      {bd.lifestyleAnnual > 0 && (
        <View style={styles.card}>
          <Text style={styles.section}>Your retirement target</Text>
          <Text style={styles.line}>Current household spending: {money(bd.currentSpending)}/year</Text>
          <Text style={styles.line}>Expenses ending before retirement: -{money(bd.endingTotal)}</Text>
          {bd.changesDelta !== 0 && (
            <Text style={styles.line}>Changes in retirement: {bd.changesDelta < 0 ? "-" : "+"}{money(Math.abs(bd.changesDelta))}</Text>
          )}
          <Text style={styles.line}>Retirement-only expenses: +{money(bd.additions)}</Text>
          <Text style={styles.line}>Retirement lifestyle target: {money(bd.lifestyleAnnual)}/year</Text>
          <Text style={styles.line}>Social Security + reliable income: -{money(hh.dependableAnnual)}</Text>
          <Text style={styles.bigLine}>Portfolio needs to provide {money(hh.portfolioGapAnnual)}/year</Text>
          <Text style={styles.line}>More Safety 3.5% -&gt; {moneyShort(hh.needConservative)}</Text>
          <Text style={styles.line}>Balanced 4.0% -&gt; {moneyShort(hh.needBase)}</Text>
          <Text style={styles.line}>More Flexible Spending 4.5% -&gt; {moneyShort(hh.needFlexible)}</Text>
          {life.confirmed ? (
            <Text style={styles.confirmedLine}>This is now your household retirement target on Home.</Text>
          ) : (
            <>
              {wasConfirmed.current && anyAmount && (
                <Text style={styles.note}>Your edits changed the target - tap to re-confirm your updated target.</Text>
              )}
              {anyAmount && (
                <Pressable style={styles.button} onPress={() => updateGoals({ lifestyle: { ...life, confirmed: true } })}>
                  <Text style={styles.buttonText}>Use this lifestyle target</Text>
                </Pressable>
              )}
            </>
          )}
        </View>
      )}

      <Text style={styles.footnote}>
        All figures are in today's dollars and use the same assumptions as Home (investment return {g.assumedReturnPct}%, inflation {g.inflationPct}%) - labelled assumptions in My House and Intake, not promises. The Balanced 4.0% line is the target Home uses; More Safety needs more saved, More Flexible Spending needs less.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F4F7FA" },
  content: { padding: 16, paddingBottom: 74, gap: 12 },
  pad: { padding: 16 },
  title: { fontSize: 25, fontWeight: "800", color: NAVY },
  purpose: { fontSize: 16, color: "#22303C", lineHeight: 23 },
  card: { backgroundColor: "#FFFFFF", borderRadius: 14, padding: 14, gap: 8 },
  section: { fontSize: 19, fontWeight: "800", color: NAVY },
  line: { fontSize: 15.5, color: "#22303C", lineHeight: 22 },
  bigLine: { fontSize: 18, fontWeight: "800", color: NAVY, lineHeight: 25, marginTop: 2 },
  note: { fontSize: 14, color: "#5A6B7C", lineHeight: 20 },
  label: { fontSize: 14, fontWeight: "600", color: TEAL, marginTop: 6 },
  button: { backgroundColor: TEAL, borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  buttonAlt: { backgroundColor: NAVY, borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  buttonText: { color: "#FFFFFF", fontWeight: "700", fontSize: 15 },
  rowButtons: { flexDirection: "row", gap: 8 },
  meterTrack: { height: 12, borderRadius: 999, backgroundColor: "#EDF2F6", overflow: "hidden" },
  meterFill: { height: 12, borderRadius: 999, backgroundColor: TEAL },
  catRow: { gap: 6, borderTopWidth: 1, borderTopColor: "#E3EAF0", paddingTop: 10 },
  catHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  catName: { flex: 1, fontSize: 16, fontWeight: "700", color: "#22303C" },
  catInput: { width: 128 },
  muted: { color: "#5A6B7C" },
  endsBadge: { backgroundColor: "#E5EBF1", borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  endsBadgeText: { fontSize: 12, fontWeight: "700", color: "#44566B" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: TEAL, paddingHorizontal: 10, paddingVertical: 5 },
  chipOn: { backgroundColor: TEAL },
  chipText: { color: TEAL, fontSize: 12.5, fontWeight: "600" },
  chipTextOn: { color: "#FFFFFF", fontSize: 12.5, fontWeight: "600" },
  adjRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  adjLabel: { flex: 1, fontSize: 14.5, color: "#22303C" },
  evHint: { fontSize: 13.5, color: TEAL, fontWeight: "600" },
  wfRow: { gap: 3 },
  wfHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 8 },
  wfLabel: { flex: 1, fontSize: 14.5, color: "#22303C" },
  wfValue: { fontSize: 15.5, fontWeight: "700", color: NAVY },
  wfBold: { fontWeight: "800", color: NAVY },
  wfTrack: { height: 12, borderRadius: 999, backgroundColor: "#EDF2F6", overflow: "hidden" },
  wfFill: { height: 12, borderRadius: 999 },
  personBlock: { gap: 2, borderTopWidth: 1, borderTopColor: "#E3EAF0", paddingTop: 10 },
  personName: { fontSize: 16, fontWeight: "800", color: NAVY },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  confirmedLine: { fontSize: 15.5, fontWeight: "700", color: GREEN, lineHeight: 22 },
  footnote: { fontSize: 12.5, color: "#5A6B7C", lineHeight: 18 },
});
