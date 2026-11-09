// Retirement Lifestyle (round 48 model, round 49 UX): the
// household's retirement target built from what it actually spends -
// not a percentage of income. Copilot's expense-based method, in
// three buckets: lifestyle spending that continues / ends / changes,
// with savings contributions and work costs kept OUT of lifestyle
// spending (they are the core reason the 70%-of-gross fallback
// inflates the target).
//
// ROUND 49 inverts the workflow around the round-48 components:
// Upload -> HomeTower understands -> the user confirms exceptions ->
// the forecast appears. The entry view offers three ranked paths
// (statements, quick estimate, manual entry); the full category
// editor lives under "Review details"; the result view leads with
// three headline lines, the waterfall, and the exceptions card -
// the few things statements cannot tell us. Bank and card statement
// CSVs uploaded in Documents arrive here as spending evidence: they
// prefill empty categories only. Every figure is in today's dollars.
import { useNavigation } from "@react-navigation/native";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { TextField } from "../components/Fields.tsx";
import { GREEN, RED } from "../components/Gauge.tsx";
import {
  ageOn,
  chooseSpending,
  householdRetirement,
  lifestyleBreakdown,
  lifestyleEffective,
  monthYearLabel,
  quickBreakdown,
  ssForMember,
  LIFESTYLE_GROUP1,
  LIFESTYLE_GROUP2,
  type LifestyleCategory,
  type LifestyleCategoryState,
} from "../goals.ts";
import { payslip401kTotals } from "../payslips.ts";
import { todayIso, useHousehold, type LifestyleExceptionsState, type LifestyleState, type QuickEstimateState } from "../store.tsx";
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

/** Like AmountInput but keeps a leading minus - the major-change
 * exception is signed (a negative amount reduces spending). */
function SignedAmountInput({ value, onChange, placeholder }: { value: number; onChange: (v: number) => void; placeholder?: string }) {
  return (
    <TextField
      value={value ? String(value) : ""}
      onChange={(v) => {
        const neg = v.trim().startsWith("-");
        const n = num(v);
        onChange(neg && n > 0 ? -n : n);
      }}
      keyboardType="numbers-and-punctuation"
      placeholder={placeholder ?? "0"}
    />
  );
}

const signed = (v: number) => `${v < 0 ? "- " : v > 0 ? "+ " : ""}${money(Math.abs(v))}`;
const BRIDGE_HINT = "Many households budget $6,000-$15,000 per person-year before Medicare.";

export default function LifestyleScreen() {
  const { state, loaded, update, updateGoals } = useHousehold();
  const navigation = useNavigation<any>();
  const today = todayIso();
  const g = state.goals;
  const life = g.lifestyle;
  const quick = g.quickEstimate;
  const ex = g.exceptions;
  const adults = state.family.filter((m) => m.role === "self" || m.role === "spouse");
  const children = state.family.filter((m) => m.role === "child");

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

  // --- Edits (any category edit un-confirms the target) ------------
  const editLife = (patch: Partial<LifestyleState>) => updateGoals({ lifestyle: { ...life, ...patch, confirmed: false } });
  const setAmount = (key: string, v: number) => editLife({ amounts: { ...life.amounts, [key]: v } });
  const setAdjusted = (key: string, v: number) => editLife({ adjusted: { ...life.adjusted, [key]: v } });
  const setCatState = (key: string, st: LifestyleCategoryState) => {
    const adjusted = { ...life.adjusted };
    if (st === "changes" && adjusted[key] === undefined) adjusted[key] = life.amounts[key] || 0;
    editLife({ states: { ...life.states, [key]: st }, adjusted });
  };
  const setQuick = (patch: Partial<QuickEstimateState>) => updateGoals({ quickEstimate: { ...quick, ...patch } });
  const setEx = (patch: Partial<LifestyleExceptionsState>) => updateGoals({ exceptions: { ...ex, ...patch } });
  const patchMember = (id: string, patch: Record<string, number>) =>
    update({ family: state.family.map((m) => (m.id === id ? { ...m, ...patch } : m)) });

  // --- The computation ---------------------------------------------
  const bd = lifestyleBreakdown(life);
  const eff = lifestyleEffective(life, ex);
  const qb = quickBreakdown(quick);
  const anyAmount = Object.values(life.amounts).some((v) => v > 0) || life.additionsAnnual > 0;
  const catPath = anyAmount || life.confirmed;
  const hasBaseline = catPath || quick.done;
  const active = catPath
    ? { current: bd.currentSpending, ending: eff.endingTotal, lifestyle: eff.lifestyleAnnual }
    : { current: qb.currentSpending, ending: qb.endingTotal, lifestyle: qb.lifestyleAnnual };

  const budgetTotal = (g.retirementBudget.housing || 0) + (g.retirementBudget.food || 0) + (g.retirementBudget.healthcare || 0) + (g.retirementBudget.travel || 0) + (g.retirementBudget.other || 0);
  const choice = chooseSpending({ lifestyle: life, exceptions: ex, customAnnual: g.retirementSpendingAnnual || 0, budgetTotal, quick, fallback: 0 });
  const sourceText =
    choice.tier === "confirmed" ? "your confirmed lifestyle target"
    : choice.tier === "quick" ? "your quick estimate"
    : choice.tier === "set" ? ((g.retirementSpendingAnnual || 0) > 0 ? "your custom figure" : "your budget worksheet")
    : "a 70% of income placeholder";

  // Social Security per adult (round 49): a typed figure wins, else
  // the adult's own Social Security statement (monthly benefit x 12).
  const ssPerAdult = adults.map((m) => ssForMember(m, state.intake.documents));
  const ssTotal = ssPerAdult.reduce((s, r) => s + r.annual, 0);
  const pensionStmtMonthly = state.intake.documents.reduce((best, d) => {
    if (d.docType !== "pension_statement" || !d.fields) return best;
    const v = Number(String(d.fields["monthly_benefit"] ?? "").replace(/[^0-9.]/g, ""));
    return Number.isFinite(v) && v > best ? v : best;
  }, 0);
  const memberPension = adults.reduce((s, m) => s + (m.pensionAnnual || 0), 0);
  const pensionAnnualEff = memberPension > 0 ? memberPension : g.pensionAnnual > 0 ? g.pensionAnnual : Math.round(pensionStmtMonthly * 12);
  const hh = householdRetirement({
    spendingAnnual: active.lifestyle,
    socialSecurityAnnual: ssTotal,
    pensionAnnual: pensionAnnualEff,
    otherAnnual: g.otherRetirementIncomeAnnual || 0,
    projectedPortfolio: 0,
  });
  const anyRetireBefore65 = adults.some((m) => ((m.retireAge || 67) > 0 ? (m.retireAge || 67) : 67) < 65);

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

  // --- Round 49 view state ------------------------------------------
  const [showStatements, setShowStatements] = useState(false);
  const [showQuick, setShowQuick] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [quickCustom, setQuickCustom] = useState(false);
  const [quickMortgage, setQuickMortgage] = useState<"" | "ends" | "keeps">(quick.mortgageEndsMonthly > 0 ? "ends" : "");
  const [quickCollege, setQuickCollege] = useState<"" | "yes" | "no">(quick.collegeEndsAnnual > 0 ? "yes" : "");
  const [collegePick, setCollegePick] = useState<"finished" | "still" | "">("");

  // College default for the exceptions card: each child's college end
  // (start + duration, the same data the Education card uses) against
  // the EARLIER adult retirement year (date of birth + retire age).
  const thisYear = Number(today.slice(0, 4));
  const collegeEndYear = (c: (typeof children)[number]): number | null => {
    if (c.studentNow) return thisYear + (c.yearsLeftInCollege > 0 ? c.yearsLeftInCollege : c.eduDurationYears || 4);
    let start = c.collegeStartYear > 0 ? c.collegeStartYear : null;
    if (start === null) {
      const age = ageOn(c.dob, today);
      if (age !== null) start = thisYear + (18 - age);
    }
    return start === null ? null : start + (c.eduDurationYears || 4);
  };
  const retireYears = adults
    .map((m) => (/^\d{4}/.test(m.dob || "") ? Number((m.dob || "").slice(0, 4)) + (m.retireAge || 67) : null))
    .filter((y): y is number => y !== null);
  const earlierRetireYear = retireYears.length > 0 ? Math.min(...retireYears) : null;
  const collegeEnds = children.map(collegeEndYear);
  const collegeFinishedByData =
    children.length > 0 && earlierRetireYear !== null && collegeEnds.every((e) => e !== null && e <= earlierRetireYear);
  const collegeSel: "" | "finished" | "still" =
    ex.collegeContinuesAnnual > 0 ? "still" : collegePick !== "" ? collegePick : collegeFinishedByData ? "finished" : "";

  // Travel exception: with a Travel amount on file, More/Less rewrite
  // the category (today x 1.2 / x 0.8 as a Changes amount); Same
  // clears it back to Continues. The answer itself always persists.
  const applyTravel = (v: "more" | "same" | "less") => {
    setEx({ travel: v });
    const amt = life.amounts["travel"] || 0;
    if (!(amt > 0)) return;
    if (v === "same") editLife({ states: { ...life.states, travel: "continues" } });
    else editLife({ states: { ...life.states, travel: "changes" }, adjusted: { ...life.adjusted, travel: Math.round(amt * (v === "more" ? 1.2 : 0.8)) } });
  };

  if (!loaded) return <View style={styles.screen}><Text style={styles.pad}>Loading...</Text></View>;

  const wfMax = Math.max(active.current, active.lifestyle, 1);
  const covMax = Math.max(active.lifestyle, hh.dependableAnnual, hh.portfolioGapAnnual, 1);
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

  const chipRow = <T extends string | number>(options: { v: T; label: string }[], value: T | "", onPick: (v: T) => void) => (
    <View style={styles.chips}>
      {options.map((o) => (
        <Pressable key={o.v} style={[styles.chip, value === o.v && styles.chipOn]} onPress={() => onPick(o.v)}>
          <Text style={[styles.chipText, value === o.v && styles.chipTextOn]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );

  // The statements section: the round-48 evidence card content (the
  // two-step Apply + the Documents upload route).
  const statementsSection = (
    <>
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
      {fillable.length === 0 && (
        <Text style={styles.note}>{Object.keys(evidence).length > 0 ? "Your statements are already reflected in the categories below - nothing empty is left to fill." : "No statement spending has been read yet. Upload a bank or card statement and HomeTower reads the spending from it."}</Text>
      )}
      <Pressable style={styles.buttonAlt} onPress={() => navigation.navigate("Documents")}>
        <Text style={styles.buttonText}>Upload a statement in Documents</Text>
      </Pressable>
      <Text style={styles.note}>Upload bank or card statements in Documents - HomeTower reads the spending from them.</Text>
    </>
  );

  const evidenceMeter = (
    <>
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
    </>
  );

  // Review details: the full round-48 editor, collapsed by default in
  // every view. The evidence card rides at its top so statement
  // amounts can be applied or refreshed from here too.
  const reviewDetails = (
    <>
      <Pressable style={styles.detailsToggle} onPress={() => setShowDetails((v) => !v)}>
        <Text style={styles.detailsToggleText}>{showDetails ? "Hide details" : "Review details"}</Text>
      </Pressable>
      {showDetails && (
        <>
          <View style={styles.card}>
            <Text style={styles.section}>Spending evidence</Text>
            {evidenceMeter}
            {statementsSection}
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
        </>
      )}
    </>
  );

  // PART C - the quick estimate flow.
  const quickSpendChips = [8000, 10000, 12000, 15000];
  const quickIsCustom = quickCustom || (quick.monthlySpend > 0 && !quickSpendChips.includes(quick.monthlySpend));
  const quickSection = (
    <View style={styles.subBlock}>
      <Text style={styles.label}>About how much does your household spend per month, excluding savings and investing?</Text>
      <View style={styles.chips}>
        {quickSpendChips.map((v) => (
          <Pressable key={v} style={[styles.chip, !quickIsCustom && quick.monthlySpend === v && styles.chipOn]} onPress={() => { setQuickCustom(false); setQuick({ monthlySpend: v, done: true }); }}>
            <Text style={[styles.chipText, !quickIsCustom && quick.monthlySpend === v && styles.chipTextOn]}>${v / 1000}K</Text>
          </Pressable>
        ))}
        <Pressable style={[styles.chip, quickIsCustom && styles.chipOn]} onPress={() => setQuickCustom(true)}>
          <Text style={[styles.chipText, quickIsCustom && styles.chipTextOn]}>Custom</Text>
        </Pressable>
      </View>
      {quickIsCustom && (
        <>
          <Text style={styles.label}>Monthly spending ($)</Text>
          <AmountInput value={quick.monthlySpend} onChange={(v) => setQuick({ monthlySpend: v, done: v > 0 })} placeholder="Per month" />
        </>
      )}
      <Text style={styles.label}>Will a mortgage payment end before you retire?</Text>
      {chipRow(
        [
          { v: "ends" as const, label: "Ends before retirement" },
          { v: "keeps" as const, label: "Keeps going, or no mortgage" },
        ],
        quickMortgage,
        (v) => { setQuickMortgage(v); if (v === "keeps") setQuick({ mortgageEndsMonthly: 0 }); },
      )}
      {quickMortgage === "ends" && (
        <>
          <Text style={styles.label}>Mortgage payment ($ per month)</Text>
          <AmountInput value={quick.mortgageEndsMonthly} onChange={(v) => setQuick({ mortgageEndsMonthly: v })} />
        </>
      )}
      <Text style={styles.label}>Are you paying for college today that will be finished by retirement?</Text>
      {chipRow(
        [
          { v: "yes" as const, label: "Yes, it ends" },
          { v: "no" as const, label: "No" },
        ],
        quickCollege,
        (v) => { setQuickCollege(v); if (v === "no") setQuick({ collegeEndsAnnual: 0 }); },
      )}
      {quickCollege === "yes" && (
        <>
          <Text style={styles.label}>College spending that ends ($ per year)</Text>
          <AmountInput value={quick.collegeEndsAnnual} onChange={(v) => setQuick({ collegeEndsAnnual: v })} />
        </>
      )}
      <Text style={styles.label}>Travel in retirement</Text>
      {chipRow(
        [
          { v: 5, label: "More" },
          { v: 0, label: "Same" },
          { v: -5, label: "Less" },
        ],
        quick.travelAdjustPct,
        (v) => setQuick({ travelAdjustPct: v }),
      )}
      {qb.currentSpending > 0 && quick.travelAdjustPct !== 0 && (
        <Text style={styles.note}>Travel change: {signed(qb.travelDelta)}/yr on today's spending.</Text>
      )}
      {anyRetireBefore65 && (
        <>
          <Text style={styles.label}>Health insurance bridge before Medicare ($ per year)</Text>
          <AmountInput value={quick.healthcareBridgeAnnual} onChange={(v) => setQuick({ healthcareBridgeAnnual: v })} placeholder="Only if retiring before 65" />
          <Text style={styles.note}>{BRIDGE_HINT}</Text>
        </>
      )}
      {(quick.done || quick.monthlySpend > 0) && (
        <Text style={styles.bigLine}>Estimated retirement lifestyle: {money(qb.lifestyleAnnual)}/yr</Text>
      )}
    </View>
  );

  // PART D - the exceptions card (category path).
  const exceptionsCard = (
    <View style={styles.card}>
      <Text style={styles.section}>A few things statements cannot tell us</Text>
      <Text style={styles.label}>Will you still have a mortgage payment in retirement?</Text>
      {chipRow(
        [
          { v: "still" as const, label: "Still paying" },
          { v: "ends" as const, label: "It ends before retirement" },
          { v: "none" as const, label: "No mortgage" },
        ],
        ex.mortgageAtRetirement,
        (v) => setEx({ mortgageAtRetirement: v }),
      )}
      {ex.mortgageAtRetirement === "ends" && (
        <>
          <Text style={styles.label}>Mortgage payment ($ per month)</Text>
          <AmountInput value={ex.mortgageMonthly} onChange={(v) => setEx({ mortgageMonthly: v })} />
          <Text style={styles.note}>This payment leaves the retirement lifestyle. If the Housing row in Review details already ends the whole payment, it is not subtracted twice.</Text>
        </>
      )}
      {children.length > 0 && (
        <>
          <Text style={styles.label}>Will college support be finished before you retire?</Text>
          {collegePick === "" && ex.collegeContinuesAnnual === 0 && earlierRetireYear !== null && (
            <Text style={styles.note}>
              {collegeFinishedByData
                ? `From your children's college dates, support looks finished before the earlier retirement year (${earlierRetireYear}) - the Finished answer is pre-picked; change it if that is wrong.`
                : `From your children's college dates, support may run past the earlier retirement year (${earlierRetireYear}) - pick the answer that fits.`}
            </Text>
          )}
          {chipRow(
            [
              { v: "finished" as const, label: "Finished" },
              { v: "still" as const, label: "Still supporting" },
            ],
            collegeSel,
            (v) => {
              setCollegePick(v);
              if (v === "finished") setEx({ collegeContinuesAnnual: 0 });
            },
          )}
          {collegeSel === "still" && (
            <>
              <Text style={styles.label}>Support continuing into retirement ($ per year)</Text>
              <AmountInput value={ex.collegeContinuesAnnual} onChange={(v) => setEx({ collegeContinuesAnnual: v })} />
            </>
          )}
        </>
      )}
      <Text style={styles.label}>Travel in retirement</Text>
      {chipRow(
        [
          { v: "more" as const, label: "More" },
          { v: "same" as const, label: "Same" },
          { v: "less" as const, label: "Less" },
        ],
        ex.travel,
        applyTravel,
      )}
      {(life.amounts["travel"] || 0) > 0
        ? <Text style={styles.note}>Applied to your Travel amount in Review details (More = 20% higher, Less = 20% lower).</Text>
        : <Text style={styles.note}>Your answer is saved; it applies as soon as a Travel amount exists in Review details.</Text>}
      {anyRetireBefore65 && (
        <>
          <Text style={styles.label}>Health insurance bridge before Medicare ($ per year)</Text>
          <AmountInput value={ex.healthcareBridgeAnnual} onChange={(v) => setEx({ healthcareBridgeAnnual: v })} placeholder="Extra cost until Medicare at 65" />
          <Text style={styles.note}>{BRIDGE_HINT}</Text>
        </>
      )}
      <Text style={styles.label}>Planning a major change? ($ per year, can be negative)</Text>
      <SignedAmountInput value={ex.majorChangeAnnual} onChange={(v) => setEx({ majorChangeAnnual: v })} placeholder="0" />
      <Text style={styles.note}>Downsizing, a move, helping family. Use a negative amount to reduce spending.</Text>
    </View>
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{hasBaseline ? "Retirement Lifestyle" : "Build your retirement lifestyle"}</Text>
      <Text style={styles.purpose}>
        {hasBaseline
          ? "Your retirement target, built from what your household actually spends - not a percentage of income."
          : "HomeTower can estimate this from how your household actually spends."}
      </Text>
      <Text style={styles.sourceLine}>Home is using: {sourceText}.</Text>

      {!hasBaseline && (
        <>
          <View style={styles.card}>
            <Text style={styles.section}>Spending evidence</Text>
            {evidenceMeter}
          </View>

          <View style={styles.card}>
            <Text style={styles.section}>Three ways to build it</Text>
            <Pressable
              style={styles.button}
              onPress={() => { setShowStatements((v) => !v); setShowQuick(false); }}
            >
              <Text style={styles.buttonText}>Use my statements</Text>
            </Pressable>
            <Text style={styles.note}>Best evidence: HomeTower reads a year of bank or card spending and builds the baseline from it.</Text>
            {showStatements && statementsSection}
            <Pressable
              style={styles.buttonAlt}
              onPress={() => { setShowQuick((v) => !v); setShowStatements(false); }}
            >
              <Text style={styles.buttonText}>Quick estimate</Text>
            </Pressable>
            <Text style={styles.note}>One monthly figure plus a few questions - about a minute.</Text>
            {showQuick && quickSection}
            <Pressable onPress={() => setShowDetails(true)}>
              <Text style={styles.textButton}>Enter manually</Text>
            </Pressable>
            <Text style={styles.note}>Type the spending category by category instead - the full editor is under Review details below.</Text>
          </View>

          {reviewDetails}
        </>
      )}

      {hasBaseline && (
        <>
          <View style={styles.card}>
            <Text style={styles.headline}>You spend about {money(active.current)}/yr today</Text>
            <Text style={styles.headline}>About {money(active.ending)}/yr ends before retirement</Text>
            <Text style={styles.headline}>
              {choice.tier === "confirmed" ? "Your retirement lifestyle" : "Estimated retirement lifestyle"}: {money(active.lifestyle)}/yr
            </Text>
            {evidenceMeter}
            {!catPath && (
              <>
                <Text style={styles.note}>This quick estimate is what Home uses until you confirm a statement-based target.</Text>
                <Pressable style={styles.button} onPress={() => setShowStatements((v) => !v)}>
                  <Text style={styles.buttonText}>Refine with statements</Text>
                </Pressable>
                {showStatements && statementsSection}
                <Pressable onPress={() => setShowQuick((v) => !v)}>
                  <Text style={styles.textButton}>{showQuick ? "Hide the quick estimate" : "Edit the quick estimate"}</Text>
                </Pressable>
                {showQuick && quickSection}
              </>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.section}>How the target is built</Text>
            {active.current > 0 ? (
              <>
                {wfBar("Current household spending", money(active.current), active.current, wfMax, NAVY)}
                {wfBar("Expenses that end", `- ${money(active.ending)}`, active.ending, wfMax, RED)}
                {catPath && wfBar("Changes in retirement", signed(bd.changesDelta), bd.changesDelta, wfMax, bd.changesDelta > 0 ? RED : GREEN)}
                {catPath && wfBar("Retirement-only additions", `+ ${money(bd.additions)}`, bd.additions, wfMax, GREEN)}
                {catPath && eff.housingRestored > 0 && wfBar("Housing stays in the base (your mortgage answer)", `+ ${money(eff.housingRestored)}`, eff.housingRestored, wfMax, GREEN)}
                {catPath && eff.mortgageOverlay > 0 && wfBar("Mortgage ends", `- ${money(eff.mortgageOverlay)}`, eff.mortgageOverlay, wfMax, RED)}
                {catPath && eff.collegeContinues > 0 && wfBar("College support continues", `+ ${money(eff.collegeContinues)}`, eff.collegeContinues, wfMax, GREEN)}
                {catPath && eff.healthcareBridge > 0 && wfBar("Healthcare bridge", `+ ${money(eff.healthcareBridge)}`, eff.healthcareBridge, wfMax, GREEN)}
                {catPath && eff.majorChange !== 0 && wfBar("Major change", signed(eff.majorChange), eff.majorChange, wfMax, eff.majorChange > 0 ? GREEN : RED)}
                {!catPath && qb.travelDelta !== 0 && wfBar("Travel change", signed(qb.travelDelta), qb.travelDelta, wfMax, qb.travelDelta > 0 ? GREEN : RED)}
                {!catPath && quick.healthcareBridgeAnnual > 0 && wfBar("Healthcare bridge", `+ ${money(quick.healthcareBridgeAnnual)}`, quick.healthcareBridgeAnnual, wfMax, GREEN)}
                {wfBar(catPath && choice.tier === "confirmed" ? "Your retirement lifestyle" : "Retirement lifestyle target", money(active.lifestyle), active.lifestyle, wfMax, NAVY, true)}
                {wfBar("Covered by Social Security & reliable income", money(hh.dependableAnnual), hh.dependableAnnual, covMax, TEAL)}
                {wfBar("Portfolio needs to provide", `${money(hh.portfolioGapAnnual)}/yr`, hh.portfolioGapAnnual, covMax, NAVY, true)}
              </>
            ) : (
              <Text style={styles.line}>Add what the household spends today and HomeTower builds the target here, step by step.</Text>
            )}
          </View>

          {catPath && exceptionsCard}

          <View style={styles.card}>
            <Text style={styles.section}>Social Security & reliable income</Text>
            <Text style={styles.note}>The same figures as My House - one shared record, edited wherever you are. Uploading the statement is the primary way in; typing is the fallback.</Text>
            {adults.map((m, i) => {
              const ss = ssPerAdult[i];
              const stmtLabel = ss.source === "statement" ? monthYearLabel(ss.statementOn) : "";
              return (
                <View key={m.id} style={styles.personBlock}>
                  <Text style={styles.personName}>{m.name || (m.role === "self" ? "You" : "Spouse")}</Text>
                  <Text style={styles.label}>Social Security</Text>
                  <Pressable style={styles.button} onPress={() => navigation.navigate("Documents")}>
                    <Text style={styles.buttonText}>Upload statement</Text>
                  </Pressable>
                  {ss.source === "statement" && (
                    <Text style={styles.note}>From your Social Security statement{stmtLabel ? ` (${stmtLabel})` : ""}: about {money(ss.annual)}/yr counts below.</Text>
                  )}
                  {ss.source === "manual" && ssStatementNote(state.intake.documents, m.id)}
                  <Text style={styles.label}>or enter manually ($ per year)</Text>
                  <AmountInput value={m.ssAnnual || 0} onChange={(v) => patchMember(m.id, { ssAnnual: v })} placeholder="From your Social Security statement" />
                  <Text style={styles.label}>Pension</Text>
                  <Pressable style={styles.buttonAlt} onPress={() => navigation.navigate("Documents")}>
                    <Text style={styles.buttonText}>Upload statement</Text>
                  </Pressable>
                  <Text style={styles.label}>or enter manually ($ per year, this person)</Text>
                  <AmountInput value={m.pensionAnnual || 0} onChange={(v) => patchMember(m.id, { pensionAnnual: v })} placeholder="Or let a pension statement in Documents speak" />
                </View>
              );
            })}
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

          {active.lifestyle > 0 && (
            <View style={styles.card}>
              <Text style={styles.section}>Your retirement target</Text>
              <Text style={styles.line}>Current household spending: {money(active.current)}/year</Text>
              <Text style={styles.line}>Expenses ending before retirement: -{money(active.ending)}</Text>
              {catPath && bd.changesDelta !== 0 && (
                <Text style={styles.line}>Changes in retirement: {signed(bd.changesDelta)}</Text>
              )}
              {catPath && <Text style={styles.line}>Retirement-only expenses: +{money(bd.additions)}</Text>}
              {catPath && eff.mortgageOverlay > 0 && <Text style={styles.line}>Mortgage ends: -{money(eff.mortgageOverlay)}</Text>}
              {catPath && eff.collegeContinues > 0 && <Text style={styles.line}>College support continues: +{money(eff.collegeContinues)}</Text>}
              {catPath && eff.healthcareBridge > 0 && <Text style={styles.line}>Healthcare bridge: +{money(eff.healthcareBridge)}</Text>}
              {catPath && eff.majorChange !== 0 && <Text style={styles.line}>Major change: {signed(eff.majorChange)}</Text>}
              {!catPath && qb.travelDelta !== 0 && <Text style={styles.line}>Travel change: {signed(qb.travelDelta)}</Text>}
              {!catPath && quick.healthcareBridgeAnnual > 0 && <Text style={styles.line}>Healthcare bridge: +{money(quick.healthcareBridgeAnnual)}</Text>}
              <Text style={styles.line}>{choice.tier === "confirmed" ? "Your retirement lifestyle" : "Retirement lifestyle target"}: {money(active.lifestyle)}/year</Text>
              <Text style={styles.line}>Social Security + reliable income: -{money(hh.dependableAnnual)}</Text>
              <Text style={styles.bigLine}>Portfolio needs to provide {money(hh.portfolioGapAnnual)}/year</Text>
              <Text style={styles.line}>More Safety 3.5% -&gt; {moneyShort(hh.needConservative)}</Text>
              <Text style={styles.line}>Balanced 4.0% -&gt; {moneyShort(hh.needBase)}</Text>
              <Text style={styles.line}>More Flexible Spending 4.5% -&gt; {moneyShort(hh.needFlexible)}</Text>
              {catPath ? (
                life.confirmed ? (
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
                )
              ) : (
                <Text style={styles.note}>This quick estimate is what Home uses until you confirm a statement-based target.</Text>
              )}
            </View>
          )}

          {reviewDetails}
        </>
      )}

      <Text style={styles.footnote}>
        All figures are in today's dollars and use the same assumptions as Home (investment return {g.assumedReturnPct}%, inflation {g.inflationPct}%) - labelled assumptions in My House and Intake, not promises. The Balanced 4.0% line is the target Home uses; More Safety needs more saved, More Flexible Spending needs less.
      </Text>
    </ScrollView>
  );
}

// When a member typed a Social Security figure AND has a statement on
// file, the typed figure wins - say so, so the statement is not
// mistaken for the source.
function ssStatementNote(docs: Parameters<typeof ssForMember>[1], memberId: string) {
  const st = ssForMember({ id: memberId, ssAnnual: 0 }, docs);
  if (st.source !== "statement") return null;
  const label = monthYearLabel(st.statementOn);
  return (
    <Text style={styles.note}>Your entered figure is used. A Social Security statement{label ? ` (${label})` : ""} on file says about {money(st.annual)}/yr.</Text>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F4F7FA" },
  content: { padding: 16, paddingBottom: 74, gap: 12 },
  pad: { padding: 16 },
  title: { fontSize: 25, fontWeight: "800", color: NAVY },
  purpose: { fontSize: 16, color: "#22303C", lineHeight: 23 },
  sourceLine: { fontSize: 15, fontWeight: "700", color: TEAL },
  headline: { fontSize: 18.5, fontWeight: "800", color: NAVY, lineHeight: 26 },
  card: { backgroundColor: "#FFFFFF", borderRadius: 14, padding: 14, gap: 8 },
  section: { fontSize: 19, fontWeight: "800", color: NAVY },
  line: { fontSize: 15.5, color: "#22303C", lineHeight: 22 },
  bigLine: { fontSize: 18, fontWeight: "800", color: NAVY, lineHeight: 25, marginTop: 2 },
  note: { fontSize: 14, color: "#5A6B7C", lineHeight: 20 },
  label: { fontSize: 14, fontWeight: "600", color: TEAL, marginTop: 6 },
  button: { backgroundColor: TEAL, borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  buttonAlt: { backgroundColor: NAVY, borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  buttonText: { color: "#FFFFFF", fontWeight: "700", fontSize: 15 },
  textButton: { color: TEAL, fontWeight: "700", fontSize: 16, paddingVertical: 6 },
  rowButtons: { flexDirection: "row", gap: 8 },
  detailsToggle: { borderRadius: 8, borderWidth: 1.5, borderColor: NAVY, paddingVertical: 11, alignItems: "center", backgroundColor: "#FFFFFF" },
  detailsToggleText: { color: NAVY, fontWeight: "800", fontSize: 15.5 },
  subBlock: { gap: 6, borderTopWidth: 1, borderTopColor: "#E3EAF0", paddingTop: 10 },
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
