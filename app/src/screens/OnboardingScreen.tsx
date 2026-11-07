import React, { useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { todayIso, useHousehold } from "../store.tsx";
import { NAVY, TEAL } from "./HomeScreen.tsx";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const LOGO_MARK = require("../../assets/logo-mark.png");

// First-run onboarding (owner QA, 2026-11-07): the user must immediately
// see where "what I have" goes and where "where I want to go" goes.
// Four short steps, skippable; everything stays editable later in Intake
// (the living record). Documents can be captured right away or later.
export default function OnboardingScreen() {
  const { state, update, updateIntake, updateGoals } = useHousehold();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [fedLow, setFedLow] = useState("2000");
  const [fedHigh, setFedHigh] = useState("3000");
  const [retTarget, setRetTarget] = useState("");
  const [eduTarget, setEduTarget] = useState("");
  const num = (v: string) => Number(v) || 0;

  const finish = () => {
    updateIntake({
      name: name.trim() || state.intake.name,
      refundTargetLow: num(fedLow),
      refundTargetHigh: num(fedHigh),
    });
    updateGoals({
      retirementTarget: num(retTarget),
      eduTarget: num(eduTarget),
    });
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
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. The Harel Family" />
        </View>
      )}

      {step === 1 && (
        <View style={styles.block}>
          <Text style={styles.h}>What do you have?</Text>
          <Text style={styles.p}>Mark what the household holds. Documents themselves go in the Documents tab - a recent payslip is the single most valuable one.</Text>
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
          <Text style={styles.p}>Today is {todayIso()} - document dates drive your confidence score, so current documents matter.</Text>
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
          <Text style={styles.label}>Retirement target ($, optional)</Text>
          <TextInput style={styles.input} value={retTarget} onChangeText={setRetTarget} keyboardType="numeric" placeholder="You can set this later" />
          <Text style={styles.label}>Education target ($, optional)</Text>
          <TextInput style={styles.input} value={eduTarget} onChangeText={setEduTarget} keyboardType="numeric" placeholder="You can set this later" />
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
  block: { backgroundColor: "#FFFFFF", borderRadius: 14, padding: 16, gap: 10 },
  h: { fontSize: 20, fontWeight: "800", color: NAVY },
  p: { fontSize: 15, color: "#22303C", lineHeight: 21 },
  label: { fontSize: 13, fontWeight: "600", color: TEAL },
  input: { backgroundColor: "#F4F7FA", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  toggleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  navRow: { flexDirection: "row", gap: 10 },
  button: { flex: 1, backgroundColor: TEAL, borderRadius: 10, paddingVertical: 14, alignItems: "center" },
  buttonText: { color: "#FFFFFF", fontWeight: "700", fontSize: 16 },
  buttonGhost: { flex: 1, borderRadius: 10, paddingVertical: 14, alignItems: "center", borderWidth: 1, borderColor: TEAL },
  ghostText: { color: TEAL, fontWeight: "700", fontSize: 16 },
  skip: { textAlign: "center", color: "#5A6B7C", fontSize: 13 },
});
