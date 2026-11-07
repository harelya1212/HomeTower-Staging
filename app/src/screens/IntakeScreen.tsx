import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { accuracyLevel, validateIntake, type Member } from "../../engine/intake.ts";
import { getPushStatus, isPushEnabled, registerForPush, type PushStatus } from "../push.ts";
import { useHousehold } from "../store.tsx";
import { NAVY, TEAL } from "./HomeScreen.tsx";

const FILING = ["married_filing_jointly", "single", "head_of_household", "married_filing_separately"];

function Field({ label, value, onChange, numeric }: { label: string; value: string; onChange: (v: string) => void; numeric?: boolean }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={styles.input} value={value} onChangeText={onChange} keyboardType={numeric ? "numeric" : "default"} />
    </View>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.label}>{label}</Text>
      <Switch value={value} onValueChange={onChange} />
    </View>
  );
}

export default function IntakeScreen() {
  const { state, update, updateIntake, updateGoals } = useHousehold();
  const goals = state.goals;
  const intake = state.intake;
  const errors = validateIntake(intake);
  const [push, setPush] = useState<PushStatus | null>(null);

  useEffect(() => {
    getPushStatus().then(setPush);
  }, []);

  const num = (v: string) => (v === "" ? 0 : Number(v) || 0);
  const setMember = (i: number, patch: Partial<Member>) => {
    const members = intake.members.map((m, j) => (j === i ? { ...m, ...patch } : m));
    updateIntake({ members });
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Household intake</Text>
      <Text style={styles.note}>Living record: edit anything, any time - the snapshot and accuracy level update immediately. Accuracy now: {accuracyLevel(intake)}</Text>

      <Field label="Household name" value={intake.name} onChange={(v) => updateIntake({ name: v })} />
      <Field label="State (2 letters)" value={intake.state} onChange={(v) => updateIntake({ state: v.toUpperCase().slice(0, 2) })} />
      <View style={styles.field}>
        <Text style={styles.label}>Filing status (tap to change)</Text>
        <Pressable
          style={styles.input}
          onPress={() => {
            const i = FILING.indexOf(intake.filingStatus);
            updateIntake({ filingStatus: FILING[(i + 1) % FILING.length] });
          }}
        >
          <Text>{intake.filingStatus}</Text>
        </Pressable>
      </View>
      <Field label="Refund target - low ($)" value={String(intake.refundTargetLow ?? "")} numeric onChange={(v) => updateIntake({ refundTargetLow: num(v) })} />
      <Field label="Refund target - high ($)" value={String(intake.refundTargetHigh ?? "")} numeric onChange={(v) => updateIntake({ refundTargetHigh: num(v) })} />

      <Text style={styles.section}>Members</Text>
      {intake.members.map((m, i) => (
        <View key={i} style={styles.memberRow}>
          <TextInput style={[styles.input, { flex: 1 }]} value={m.name} placeholder={`Member ${i + 1} name`} onChangeText={(v) => setMember(i, { name: v })} />
          <Pressable onPress={() => updateIntake({ members: intake.members.filter((_, j) => j !== i) })}>
            <Text style={styles.remove}>Remove</Text>
          </Pressable>
        </View>
      ))}
      <Pressable style={styles.button} onPress={() => updateIntake({ members: [...intake.members, { name: "", role: "adult", payFrequency: "biweekly" }] })}>
        <Text style={styles.buttonText}>Add member</Text>
      </Pressable>

      <Text style={styles.section}>What the household holds</Text>
      <Toggle label="RSU (employer stock units)" value={!!intake.hasRsu} onChange={(v) => updateIntake({ hasRsu: v })} />
      <Toggle label="ESPP (employee stock purchase)" value={!!intake.hasEspp} onChange={(v) => updateIntake({ hasEspp: v })} />
      <Toggle label="Accounts or income outside the US" value={!!intake.hasForeignAccountsOrIncome} onChange={(v) => updateIntake({ hasForeignAccountsOrIncome: v })} />
      <Toggle label="Year-to-date payroll is known" value={!!intake.ytdPayrollKnown} onChange={(v) => updateIntake({ ytdPayrollKnown: v })} />
      <Toggle label="Capital-loss carryforward is known" value={!!intake.capitalLossCarryforwardKnown} onChange={(v) => updateIntake({ capitalLossCarryforwardKnown: v })} />

      <Text style={styles.section}>Current numbers (year to date)</Text>
      <Field label="Gross income ($)" value={String(state.grossIncome || "")} numeric onChange={(v) => update({ grossIncome: num(v) })} />
      <Field label="Federal withholding YTD ($)" value={String(state.federalWithholdingYtd || "")} numeric onChange={(v) => update({ federalWithholdingYtd: num(v) })} />
      <Field label="State withholding YTD ($)" value={String(state.stateWithholdingYtd || "")} numeric onChange={(v) => update({ stateWithholdingYtd: num(v) })} />
      <Field label="Long-term capital gains ($)" value={String(state.ltcgIncome || "")} numeric onChange={(v) => update({ ltcgIncome: num(v) })} />

      <Text style={styles.section}>Where you want to go - goals</Text>
      <Text style={styles.note}>These drive the Home dashboard gauges. The growth assumption is yours to set - it is an assumption, shown on the dashboard, never a promise.</Text>
      <Field label="State refund target - low ($)" value={String(goals.stateRefundTargetLow || "")} numeric onChange={(v) => updateGoals({ stateRefundTargetLow: num(v) })} />
      <Field label="State refund target - high ($)" value={String(goals.stateRefundTargetHigh || "")} numeric onChange={(v) => updateGoals({ stateRefundTargetHigh: num(v) })} />
      <Field label="Retirement savings today ($)" value={String(goals.retirementBalance || "")} numeric onChange={(v) => updateGoals({ retirementBalance: num(v) })} />
      <Field label="Retirement saving per month ($)" value={String(goals.retirementMonthly || "")} numeric onChange={(v) => updateGoals({ retirementMonthly: num(v) })} />
      <Field label="Years until retirement" value={String(goals.retirementYears || "")} numeric onChange={(v) => updateGoals({ retirementYears: num(v) })} />
      <Field label="Retirement target ($)" value={String(goals.retirementTarget || "")} numeric onChange={(v) => updateGoals({ retirementTarget: num(v) })} />
      <Field label="Education savings today ($)" value={String(goals.eduBalance || "")} numeric onChange={(v) => updateGoals({ eduBalance: num(v) })} />
      <Field label="Education saving per month ($)" value={String(goals.eduMonthly || "")} numeric onChange={(v) => updateGoals({ eduMonthly: num(v) })} />
      <Field label="Years until education money is needed" value={String(goals.eduYears || "")} numeric onChange={(v) => updateGoals({ eduYears: num(v) })} />
      <Field label="Education target ($)" value={String(goals.eduTarget || "")} numeric onChange={(v) => updateGoals({ eduTarget: num(v) })} />
      <Field label="Assumed yearly growth (%)" value={String(goals.assumedReturnPct || "")} numeric onChange={(v) => updateGoals({ assumedReturnPct: num(v) })} />

      <Text style={styles.section}>Calibration - last year's filed return</Text>
      <Text style={styles.note}>
        The basic plan always asks for this: the return as filed to the IRS and the state, checked against what actually
        happened (the refund you received or the amount you owed). It is the anchor that calibrates every projection.
        {(!intake.calibration || !intake.calibration.outcomeVerified) ? " Not verified yet - the app will keep asking." : " Verified."}
      </Text>
      <Field label="Tax year filed" value={String(intake.calibration?.taxYear ?? new Date().getFullYear() - 1)} numeric onChange={(v) => updateIntake({ calibration: { ...intake.calibration, taxYear: num(v) } })} />
      <Toggle label="Federal return filed" value={!!intake.calibration?.federalFiled} onChange={(v) => updateIntake({ calibration: { ...intake.calibration, taxYear: intake.calibration?.taxYear ?? new Date().getFullYear() - 1, federalFiled: v } })} />
      <Toggle label="State return filed" value={!!intake.calibration?.stateFiled} onChange={(v) => updateIntake({ calibration: { ...intake.calibration, taxYear: intake.calibration?.taxYear ?? new Date().getFullYear() - 1, stateFiled: v } })} />
      <Field label="Actual federal outcome ($, + refund / - owed)" value={String(intake.calibration?.actualFederalRefundOwe ?? "")} onChange={(v) => updateIntake({ calibration: { ...intake.calibration, taxYear: intake.calibration?.taxYear ?? new Date().getFullYear() - 1, actualFederalRefundOwe: v === "" ? null : Number(v) || 0 } })} />
      <Field label="Actual state outcome ($, + refund / - owed)" value={String(intake.calibration?.actualStateRefundOwe ?? "")} onChange={(v) => updateIntake({ calibration: { ...intake.calibration, taxYear: intake.calibration?.taxYear ?? new Date().getFullYear() - 1, actualStateRefundOwe: v === "" ? null : Number(v) || 0 } })} />
      <Toggle label="Outcome verified against the IRS/state response" value={!!intake.calibration?.outcomeVerified} onChange={(v) => updateIntake({ calibration: { ...intake.calibration, taxYear: intake.calibration?.taxYear ?? new Date().getFullYear() - 1, outcomeVerified: v } })} />

      <Text style={styles.section}>Push reminders</Text>
      <Toggle label="Push reminders (default ON)" value={state.pushEnabled} onChange={(v) => update({ pushEnabled: v })} />
      <Pressable
        style={styles.button}
        onPress={async () => setPush(await registerForPush())}
      >
        <Text style={styles.buttonText}>Register this device for push</Text>
      </Pressable>
      {push && (
        <View style={styles.diagnostics}>
          <Text style={styles.line}>Status: {isPushEnabled(state.pushEnabled, push) ? "ENABLED (token stored)" : "not enabled"}</Text>
          <Text style={styles.line}>Stage: {push.stage} - Permission: {push.permission}</Text>
          <Text style={styles.line}>Token: {push.token ? "stored" : "none"} - Scheduled: {push.scheduledCount}</Text>
          {push.error ? <Text style={styles.error}>{push.error}</Text> : null}
        </View>
      )}

      {errors.length > 0 && (
        <View style={styles.diagnostics}>
          <Text style={styles.error}>To fix:</Text>
          {errors.map((e) => (
            <Text key={e} style={styles.error}>- {e}</Text>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F4F7FA" },
  content: { padding: 16, gap: 10 },
  title: { fontSize: 22, fontWeight: "700", color: NAVY },
  note: { fontSize: 13, color: "#5A6B7C" },
  section: { fontSize: 16, fontWeight: "700", color: NAVY, marginTop: 10 },
  field: { gap: 4 },
  label: { fontSize: 13, fontWeight: "600", color: TEAL },
  input: { backgroundColor: "#FFFFFF", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  toggleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  memberRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  remove: { color: "#C5221F", fontWeight: "600" },
  button: { backgroundColor: TEAL, borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  buttonText: { color: "#FFFFFF", fontWeight: "700" },
  diagnostics: { backgroundColor: "#FFFFFF", borderRadius: 8, padding: 12, gap: 4 },
  line: { fontSize: 13, color: "#22303C" },
  error: { fontSize: 13, color: "#C5221F" },
});
