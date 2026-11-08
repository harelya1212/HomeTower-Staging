import React, { useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { DateField, StatePicker } from "../components/Fields.tsx";
import { pickAndRestore } from "../backup.ts";
import { useHousehold } from "../store.tsx";
import { NAVY, TEAL } from "./HomeScreen.tsx";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const LOGO_MARK = require("../../assets/logo-mark.png");

// First-run onboarding (owner QA, 2026-11-07): the user must immediately
// see where "what I have" goes and where "where I want to go" goes.
// Four short steps, skippable; everything stays editable later in Intake
// (the living record). Documents can be captured right away or later.
export default function OnboardingScreen() {
  const { state, update, updateIntake, updateGoals, restore } = useHousehold();
  const [restoreNote, setRestoreNote] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [fedLow, setFedLow] = useState("2000");
  const [fedHigh, setFedHigh] = useState("3000");
  const [selfRetireAge, setSelfRetireAge] = useState("67");
  const [spouseRetireAge, setSpouseRetireAge] = useState("67");
  const [selfRetTarget, setSelfRetTarget] = useState("");
  const [spouseRetTarget, setSpouseRetTarget] = useState("");
  const [childTargets, setChildTargets] = useState<string[]>([]);
  const [selfDob, setSelfDob] = useState("");
  const [spouseDob, setSpouseDob] = useState("");
  const [childCount, setChildCount] = useState("");
  const num = (v: string) => Number(v) || 0;
  const married = state.intake.filingStatus.startsWith("married");

  const finish = () => {
    const householdName = name.trim() || state.intake.name;
    updateIntake({
      name: householdName,
      refundTargetLow: num(fedLow),
      refundTargetHigh: num(fedHigh),
    });
    // Seed the My House family table from the quick start (only when the
    // table is still empty - never overwrite a filled table). Retirement
    // is per adult and education per child (owner QA round 8): the ages
    // and personal targets land on each person's own row.
    if (state.family.length === 0 && (selfDob || spouseDob || num(childCount) > 0)) {
      updateGoals({ retirementTarget: 0, eduTarget: 0 });
      const fam = [];
      if (selfDob || true) fam.push({ id: "ob-self", name: "", role: "self" as const, dob: selfDob, retireAge: num(selfRetireAge) || 67, retireTarget: num(selfRetTarget), eduTarget: 0, studentNow: false, collegeStartYear: 0, yearsLeftInCollege: 0 });
      if (married) fam.push({ id: "ob-spouse", name: "", role: "spouse" as const, dob: spouseDob, retireAge: num(spouseRetireAge) || 67, retireTarget: num(spouseRetTarget), eduTarget: 0, studentNow: false, collegeStartYear: 0, yearsLeftInCollege: 0 });
      for (let i = 0; i < Math.min(6, num(childCount)); i++) fam.push({ id: `ob-child-${i}`, name: "", role: "child" as const, dob: "", retireAge: 67, retireTarget: 0, eduTarget: num(childTargets[i] ?? ""), studentNow: false, collegeStartYear: 0, yearsLeftInCollege: 0 });
      update({ family: fam });
      updateIntake({ members: fam.filter((m) => m.dob).map((m) => ({ name: m.name, role: m.role, dateOfBirth: m.dob || null })) });
    }
    update({ onboarded: true });
  };
  const skip = () => update({ onboarded: true });

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.brandRow}>
        <Image source={LOGO_MARK} style={styles.logo} resizeMode="contain" />
        <Text style={styles.brand}>HomeTower</Text>
      </View>
      <Text style={styles.stepLabel}>Step {step + 1} of 4</Text>

      {step === 0 && (
        <View style={styles.block}>
          <Text style={styles.h}>Welcome. Two minutes to set up your tower.</Text>
          <Text style={styles.p}>HomeTower keeps one clear, always-current picture of your household money: what you have, where you want to go, and what to do next. Everything stays on this device, and everything stays editable.</Text>
          <Text style={styles.label}>Household name</Text>
          <TextInput style={styles.input} value={name} onChangeText={(v) => { setName(v); updateIntake({ name: v }); }} placeholder="e.g. The Harel Family" />
        </View>
      )}

      {step === 1 && (
        <View style={styles.block}>
          <Text style={styles.h}>Your family</Text>
          <Text style={styles.p}>Dates of birth drive the retirement and education timing. The full family table - children, jobs, assets - lives in the My House tab; this is the quick start.</Text>
          <Text style={styles.label}>How do you file?</Text>
          <View style={styles.chipWrap}>
            {(
              [
                ["married_filing_jointly", "Married, jointly"],
                ["married_filing_separately", "Married, separately"],
                ["single", "Single"],
                ["head_of_household", "Head of household"],
              ] as const
            ).map(([value, label]) => (
              <Pressable key={value} onPress={() => updateIntake({ filingStatus: value })} style={[styles.chip, state.intake.filingStatus === value && styles.chipOn]}>
                <Text style={[styles.chipText, state.intake.filingStatus === value && styles.chipTextOn]}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.label}>State of residence</Text>
          <StatePicker value={state.intake.state} onChange={(v) => updateIntake({ state: v })} />
          <Text style={styles.label}>Your date of birth</Text>
          <DateField value={selfDob} onChange={setSelfDob} />
          {married && (
            <>
              <Text style={styles.label}>Spouse date of birth</Text>
              <DateField value={spouseDob} onChange={setSpouseDob} />
            </>
          )}
          <Text style={styles.label}>Children (how many)</Text>
          <TextInput style={styles.input} value={childCount} onChangeText={setChildCount} keyboardType="numeric" placeholder="0" />
          <Text style={styles.label}>Any of these in the household?</Text>
          {(
            [
              ["Employer stock units (RSU)", "hasRsu"],
              ["Employee stock purchase (ESPP)", "hasEspp"],
              ["Accounts or income outside the US", "hasForeignAccountsOrIncome"],
            ] as const
          ).map(([label, key]) => (
            <View key={key} style={styles.toggleRow}>
              <Text style={styles.label}>{label}</Text>
              <Switch value={!!state.intake[key]} onValueChange={(v) => updateIntake({ [key]: v })} />
            </View>
          ))}
        </View>
      )}

      {step === 2 && (
        <View style={styles.block}>
          <Text style={styles.h}>Where do you want to go?</Text>
          <Text style={styles.p}>Your targets become the gauges on the Home dashboard.</Text>
          <Text style={styles.label}>Federal refund target - low ($)</Text>
          <TextInput style={styles.input} value={fedLow} onChangeText={setFedLow} keyboardType="numeric" />
          <Text style={styles.label}>Federal refund target - high ($)</Text>
          <TextInput style={styles.input} value={fedHigh} onChangeText={setFedHigh} keyboardType="numeric" />
          <Text style={styles.label}>Retirement - you: planned retirement age</Text>
          <TextInput style={styles.input} value={selfRetireAge} onChangeText={setSelfRetireAge} keyboardType="numeric" placeholder="67" />
          <Text style={styles.label}>Retirement target - you ($, optional)</Text>
          <TextInput style={styles.input} value={selfRetTarget} onChangeText={setSelfRetTarget} keyboardType="numeric" placeholder="You can set this later" />
          {married && (
            <>
              <Text style={styles.label}>Retirement - spouse: planned retirement age</Text>
              <TextInput style={styles.input} value={spouseRetireAge} onChangeText={setSpouseRetireAge} keyboardType="numeric" placeholder="67" />
              <Text style={styles.label}>Retirement target - spouse ($, optional)</Text>
              <TextInput style={styles.input} value={spouseRetTarget} onChangeText={setSpouseRetTarget} keyboardType="numeric" placeholder="You can set this later" />
            </>
          )}
          {Array.from({ length: Math.min(6, num(childCount)) }, (_, i) => (
            <View key={i}>
              <Text style={styles.label}>Education target - child {i + 1} ($, optional)</Text>
              <TextInput
                style={styles.input}
                value={childTargets[i] ?? ""}
                onChangeText={(v) => setChildTargets((prev) => { const next = [...prev]; next[i] = v; return next; })}
                keyboardType="numeric"
                placeholder="You can set this later"
              />
            </View>
          ))}
        </View>
      )}

      {step === 3 && (
        <View style={styles.block}>
          <Text style={styles.h}>One calibration anchor</Text>
          <Text style={styles.p}>The strongest calibration we have is last year's return as filed, checked against what the IRS and the state actually did (the refund that arrived, or the amount you owed). Add it any time in the Intake tab - until then, HomeTower will keep gently asking, and your confidence score will say why.</Text>
          <Text style={styles.p}>Push reminders about old documents are ON by default.</Text>
        </View>
      )}

      <View style={styles.navRow}>
        {step > 0 ? (
          <Pressable style={styles.buttonGhost} onPress={() => setStep(step - 1)}><Text style={styles.ghostText}>Back</Text></Pressable>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        {step < 3 ? (
          <Pressable style={styles.button} onPress={() => setStep(step + 1)}><Text style={styles.buttonText}>Continue</Text></Pressable>
        ) : (
          <Pressable style={styles.button} onPress={finish}><Text style={styles.buttonText}>Start</Text></Pressable>
        )}
      </View>
      <Pressable onPress={skip}><Text style={styles.skip}>Skip for now - everything stays editable in the Intake tab</Text></Pressable>
      <Pressable onPress={async () => setRestoreNote(await pickAndRestore(restore))}>
        <Text style={styles.skip}>Already entered your household before? Restore from a backup file</Text>
      </Pressable>
      {restoreNote && <Text style={styles.skip}>{restoreNote}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F4F7FA" },
  content: { padding: 20, gap: 14 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10, justifyContent: "center", marginTop: 12 },
  logo: { width: 52, height: 52, borderRadius: 12 },
  brand: { fontSize: 30, fontWeight: "800", color: NAVY },
  stepLabel: { textAlign: "center", color: TEAL, fontWeight: "700", fontSize: 13 },
  block: { backgroundColor: "#FFFFFF", borderRadius: 14, padding: 18, gap: 11 },
  h: { fontSize: 23, fontWeight: "800", color: NAVY },
  p: { fontSize: 16.5, color: "#22303C", lineHeight: 24 },
  label: { fontSize: 15, fontWeight: "700", color: TEAL },
  input: { backgroundColor: "#F4F7FA", borderRadius: 10, paddingHorizontal: 13, paddingVertical: 12, fontSize: 17 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1.5, borderColor: TEAL, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  chipOn: { backgroundColor: TEAL },
  chipText: { color: TEAL, fontWeight: "700", fontSize: 15 },
  chipTextOn: { color: "#FFFFFF" },
  toggleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  navRow: { flexDirection: "row", gap: 10 },
  button: { flex: 1, backgroundColor: TEAL, borderRadius: 10, paddingVertical: 14, alignItems: "center" },
  buttonText: { color: "#FFFFFF", fontWeight: "700", fontSize: 16 },
  buttonGhost: { flex: 1, borderRadius: 10, paddingVertical: 14, alignItems: "center", borderWidth: 1, borderColor: TEAL },
  ghostText: { color: TEAL, fontWeight: "700", fontSize: 16 },
  skip: { textAlign: "center", color: "#5A6B7C", fontSize: 13 },
});
