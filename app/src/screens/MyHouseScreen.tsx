import { useNavigation } from "@react-navigation/native";
import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { DateField, StatePicker, TextField } from "../components/Fields.tsx";
import type { Asset, AssetKind, Job, UiMember } from "../store.tsx";
import { todayIso, useHousehold } from "../store.tsx";
import { NAVY, TEAL } from "./HomeScreen.tsx";

// "My House" - the household's own page (owner QA round 2): the family,
// the jobs, the assets, in editable tables with big readable type.
// Everything here is the living record: it syncs into the engine intake
// and drives the dashboard (retirement years come from ages, balances
// from the assets table). A parsed document can pre-fill a row; the
// user always confirms and can edit, add and remove freely.

const FILING: [string, string][] = [
  ["married_filing_jointly", "Married, filing jointly"],
  ["married_filing_separately", "Married, filing separately"],
  ["single", "Single"],
  ["head_of_household", "Head of household"],
];
const ROLES: UiMember["role"][] = ["self", "spouse", "child", "other"];
const FREQS: Job["payFrequency"][] = ["weekly", "biweekly", "semimonthly", "monthly"];
const KINDS: AssetKind[] = ["home", "brokerage", "401k", "ira", "hsa", "529", "bank", "rental", "other"];
const KIND_LABEL: Record<AssetKind, string> = { home: "Home", brokerage: "Stocks / brokerage", "401k": "401(k)", ira: "IRA / Roth", hsa: "HSA", "529": "529 education", bank: "Bank", rental: "Rental property", other: "Other" };

let seq = 0;
const newId = () => `row-${Date.now()}-${seq++}`;
const num = (v: string) => Number(v) || 0;

// Pick a person from the family table instead of typing the name again
// (owner QA round 4: "the user already typed the family members").
function NamePicker({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  const all = value && !options.includes(value) ? [value, ...options] : options;
  if (all.length === 0) return <TextField value={value} onChange={onChange} placeholder="Name" />;
  return (
    <View style={styles.chipWrap}>
      {all.map((name) => (
        <Pressable key={name} onPress={() => onChange(name)} style={[styles.chip, value === name && styles.chipOn]}>
          <Text style={[styles.chipText, value === name && styles.chipTextOn]}>{name}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const KIND_BY_DOC: Record<string, AssetKind> = {
  "401k_statement": "401k",
  hsa_statement: "hsa",
  brokerage_statement: "brokerage",
  "529_statement": "529",
};

export default function MyHouseScreen() {
  const { state, update, updateIntake } = useHousehold();
  const navigation = useNavigation<any>();
  const intake = state.intake;
  const family = state.family;
  const jobs = state.jobs;
  const assets = state.assets;
  const familyNames = family.map((m) => m.name.trim()).filter(Boolean);
  const [pickedAssets, setPickedAssets] = useState<Set<string>>(new Set());

  const setFamily = (next: UiMember[]) => {
    update({ family: next });
    updateIntake({ members: next.filter((m) => m.name.trim()).map((m) => ({ name: m.name.trim(), role: m.role, dateOfBirth: m.dob || null })) });
  };
  const patchMember = (id: string, patch: Partial<UiMember>) => setFamily(family.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const setJobs = (next: Job[]) => update({ jobs: next });
  const patchJob = (id: string, patch: Partial<Job>) => setJobs(jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  const setAssets = (next: Asset[]) => update({ assets: next });
  const patchAsset = (id: string, patch: Partial<Asset>) => setAssets(assets.map((a) => (a.id === id ? { ...a, ...patch } : a)));

  // Prefill offer: an employer found on a parsed payslip becomes a job
  // in one tap (the user confirms; nothing is added silently).
  const payslip = intake.documents.filter((d) => d.docType === "payslip" && d.fields).slice(-1)[0];
  let payslipEmployer = "";
  if (payslip?.fields) {
    for (const [k, v] of Object.entries(payslip.fields)) if (/employ/i.test(k) && typeof v === "string" && v) payslipEmployer = v;
  }
  const employerKnown = payslipEmployer !== "" && jobs.some((j) => j.employer.toLowerCase() === payslipEmployer.toLowerCase());

  // Asset rows proposed from parsed statements (owner QA round 4: a
  // photo of a statement should generate the rows, with multi-select -
  // not typing). A candidate disappears once an asset with the same
  // kind and value exists, so nothing is offered twice.
  interface AssetCandidate { key: string; kind: AssetKind; label: string; value: number }
  const assetCandidates: AssetCandidate[] = [];
  intake.documents.forEach((d, i) => {
    const kind = KIND_BY_DOC[d.docType];
    if (!kind || d.status !== "parsed" || !d.fields) return;
    const bal = Number(d.fields["ending_balance"] ?? d.fields["vested_balance"]);
    if (!bal || Number.isNaN(bal)) return;
    if (assets.some((a) => a.kind === kind && a.value === bal)) return;
    assetCandidates.push({ key: `doc-${i}`, kind, label: `${KIND_LABEL[kind]} - statement ${d.capturedOn ?? "undated"}`, value: bal });
  });
  const addPickedAssets = () => {
    const chosen = assetCandidates.filter((c) => pickedAssets.has(c.key));
    if (!chosen.length) return;
    setAssets([...assets, ...chosen.map((c) => ({ id: newId(), kind: c.kind, label: c.label, ownerName: "", value: c.value, monthly: 0 }))]);
    setPickedAssets(new Set());
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{intake.name || "My House"}</Text>
      <Text style={styles.intro}>Everyone and everything in the household, in one place. Edit anything, any time - the dashboard and the projections follow. Everything saves automatically on this device as you type - there is no save button.</Text>

      <Text style={styles.section}>Household</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Household name (shown on the tab bar)</Text>
        <TextField value={intake.name} onChange={(v) => updateIntake({ name: v })} placeholder="e.g. The Harel Family" />
        <Text style={styles.label}>State of residence</Text>
        <StatePicker value={intake.state} onChange={(v) => updateIntake({ state: v })} />
        {intake.state !== "AZ" && <Text style={styles.warn}>Phase 1 computes Arizona tax. Your state is recorded and its pack joins in a later phase - the federal picture already works.</Text>}
        <Text style={styles.label}>How do you file?</Text>
        <View style={styles.chipWrap}>
          {FILING.map(([value, label]) => (
            <Pressable key={value} onPress={() => updateIntake({ filingStatus: value })} style={[styles.chip, intake.filingStatus === value && styles.chipOn]}>
              <Text style={[styles.chipText, intake.filingStatus === value && styles.chipTextOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <Text style={styles.section}>Family</Text>
      <Text style={styles.intro}>Dates of birth drive the retirement timing and the education timing - no typing your age anywhere else.</Text>
      {family.map((m) => (
        <View key={m.id} style={styles.card}>
          <TextField value={m.name} onChange={(v) => patchMember(m.id, { name: v })} placeholder="Full name" />
          <View style={styles.chipWrap}>
            {ROLES.map((r) => (
              <Pressable key={r} onPress={() => patchMember(m.id, { role: r })} style={[styles.chip, m.role === r && styles.chipOn]}>
                <Text style={[styles.chipText, m.role === r && styles.chipTextOn]}>{r === "self" ? "You" : r[0].toUpperCase() + r.slice(1)}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.label}>Date of birth</Text>
          <DateField value={m.dob} onChange={(v) => patchMember(m.id, { dob: v })} />
          {(m.role === "self" || m.role === "spouse") && (
            <>
              <Text style={styles.label}>Planned retirement age</Text>
              <TextInput style={styles.input} value={String(m.retireAge || "")} keyboardType="numeric" onChangeText={(v) => patchMember(m.id, { retireAge: num(v) })} placeholder="67" />
            </>
          )}
          {m.role === "child" && (
            <>
              <View style={styles.toggleRow}>
                <Text style={styles.label}>In college now</Text>
                <Switch value={m.studentNow} onValueChange={(v) => patchMember(m.id, { studentNow: v })} />
              </View>
              {m.studentNow ? (
                <>
                  <Text style={styles.label}>Years left in college</Text>
                  <TextInput style={styles.input} value={String(m.yearsLeftInCollege || "")} keyboardType="numeric" onChangeText={(v) => patchMember(m.id, { yearsLeftInCollege: num(v) })} placeholder="2" />
                </>
              ) : (
                <>
                  <Text style={styles.label}>College start year (blank = from age 18)</Text>
                  <TextInput style={styles.input} value={String(m.collegeStartYear || "")} keyboardType="numeric" onChangeText={(v) => patchMember(m.id, { collegeStartYear: num(v) })} placeholder="2031" />
                </>
              )}
            </>
          )}
          <Pressable onPress={() => setFamily(family.filter((x) => x.id !== m.id))}><Text style={styles.remove}>Remove</Text></Pressable>
        </View>
      ))}
      <Pressable style={styles.addButton} onPress={() => setFamily([...family, { id: newId(), name: "", role: family.length === 0 ? "self" : "child", dob: "", retireAge: 67, studentNow: false, collegeStartYear: 0, yearsLeftInCollege: 0 }])}>
        <Text style={styles.addText}>+ Add a family member</Text>
      </Pressable>

      <Text style={styles.section}>Jobs</Text>
      <Text style={styles.intro}>One row per job. Changed employer mid-year? End the old row with its last date and add the new job as current - expect two W-2s that year, and HomeTower will ask for both.</Text>
      {payslipEmployer !== "" && !employerKnown && (
        <Pressable style={styles.prefill} onPress={() => setJobs([...jobs, { id: newId(), memberName: family[0]?.name ?? "", employer: payslipEmployer, startDate: "", endDate: "", payFrequency: "biweekly" }])}>
          <Text style={styles.prefillText}>From your payslip: {payslipEmployer} - tap to add as a job</Text>
        </Pressable>
      )}
      {jobs.map((j) => (
        <View key={j.id} style={styles.card}>
          <Text style={styles.label}>Who works there</Text>
          <NamePicker options={familyNames} value={j.memberName} onChange={(v) => patchJob(j.id, { memberName: v })} />
          <Text style={styles.label}>Employer</Text>
          <TextField value={j.employer} onChange={(v) => patchJob(j.id, { employer: v })} placeholder="Employer name" />
          <Text style={styles.label}>Started</Text>
          <DateField value={j.startDate} onChange={(v) => patchJob(j.id, { startDate: v })} />
          <View style={styles.toggleRow}>
            <Text style={styles.label}>Current job</Text>
            <Switch value={j.endDate === ""} onValueChange={(v) => patchJob(j.id, { endDate: v ? "" : todayIso() })} />
          </View>
          {j.endDate !== "" && (
            <>
              <Text style={styles.label}>Last day</Text>
              <DateField value={j.endDate} onChange={(v) => patchJob(j.id, { endDate: v })} />
            </>
          )}
          <Text style={styles.label}>Pay frequency</Text>
          <View style={styles.chipWrap}>
            {FREQS.map((f) => (
              <Pressable key={f} onPress={() => patchJob(j.id, { payFrequency: f })} style={[styles.chip, j.payFrequency === f && styles.chipOn]}>
                <Text style={[styles.chipText, j.payFrequency === f && styles.chipTextOn]}>{f}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={() => setJobs(jobs.filter((x) => x.id !== j.id))}><Text style={styles.remove}>Remove</Text></Pressable>
        </View>
      ))}
      <Pressable style={styles.addButton} onPress={() => setJobs([...jobs, { id: newId(), memberName: "", employer: "", startDate: "", endDate: "", payFrequency: "biweekly" }])}>
        <Text style={styles.addText}>+ Add a job</Text>
      </Pressable>

      <Text style={styles.section}>Assets - what the household has</Text>
      <Text style={styles.intro}>Balances here feed the dashboard rings: 401(k) and IRA rows build the retirement ring, 529 rows build the education ring. For a 529, put the child's name as the owner.</Text>
      {assetCandidates.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.label}>From your documents - tap to select, add them together</Text>
          {assetCandidates.map((c) => {
            const on = pickedAssets.has(c.key);
            return (
              <Pressable
                key={c.key}
                style={[styles.candidate, on && styles.candidateOn]}
                onPress={() => setPickedAssets((prev) => { const next = new Set(prev); if (next.has(c.key)) next.delete(c.key); else next.add(c.key); return next; })}
              >
                <Text style={styles.candidateText}>{on ? "☑" : "☐"} {c.label} - ${c.value.toLocaleString("en-US")}</Text>
              </Pressable>
            );
          })}
          <Pressable style={styles.addButton} onPress={addPickedAssets}>
            <Text style={styles.addText}>Add selected ({pickedAssets.size})</Text>
          </Pressable>
        </View>
      )}
      <Pressable style={styles.prefill} onPress={() => navigation.navigate("Documents")}>
        <Text style={styles.prefillText}>📷 Photograph a statement instead of typing - rows are created here from what the photo reads</Text>
      </Pressable>
      {assets.map((a) => (
        <View key={a.id} style={styles.card}>
          <TextField value={a.label} onChange={(v) => patchAsset(a.id, { label: v })} placeholder="Label, e.g. Fidelity 401(k)" />
          <View style={styles.chipWrap}>
            {KINDS.map((k) => (
              <Pressable key={k} onPress={() => patchAsset(a.id, { kind: k })} style={[styles.chip, a.kind === k && styles.chipOn]}>
                <Text style={[styles.chipText, a.kind === k && styles.chipTextOn]}>{KIND_LABEL[k]}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.label}>Owner (for a 529: the child)</Text>
          <NamePicker options={familyNames} value={a.ownerName} onChange={(v) => patchAsset(a.id, { ownerName: v })} />
          <Text style={styles.label}>Value today ($)</Text>
          <TextInput style={styles.input} value={String(a.value || "")} keyboardType="numeric" onChangeText={(v) => patchAsset(a.id, { value: num(v) })} />
          <Text style={styles.label}>Added per month ($)</Text>
          <TextInput style={styles.input} value={String(a.monthly || "")} keyboardType="numeric" onChangeText={(v) => patchAsset(a.id, { monthly: num(v) })} />
          <Pressable onPress={() => setAssets(assets.filter((x) => x.id !== a.id))}><Text style={styles.remove}>Remove</Text></Pressable>
        </View>
      ))}
      <Pressable style={styles.addButton} onPress={() => setAssets([...assets, { id: newId(), kind: "bank", label: "", ownerName: "", value: 0, monthly: 0 }])}>
        <Text style={styles.addText}>+ Add an asset</Text>
      </Pressable>

      <View style={styles.card}>
        <Text style={styles.note}>Tip: photograph a statement in the Documents tab - the register fills from it, and rows here can be pre-filled from what was found. Everything stays editable.</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F4F7FA" },
  content: { padding: 16, paddingBottom: 74, gap: 10 },
  title: { fontSize: 26, fontWeight: "800", color: NAVY },
  intro: { fontSize: 15.5, color: "#41505E", lineHeight: 22 },
  section: { fontSize: 20, fontWeight: "800", color: NAVY, marginTop: 10 },
  card: { backgroundColor: "#FFFFFF", borderRadius: 14, padding: 14, gap: 8 },
  label: { fontSize: 15, fontWeight: "600", color: TEAL },
  input: { backgroundColor: "#F4F7FA", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, fontSize: 17 },
  warn: { fontSize: 14, color: "#B3261E", lineHeight: 20 },
  note: { fontSize: 15, color: "#41505E", lineHeight: 21 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1.5, borderColor: TEAL, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  chipOn: { backgroundColor: TEAL },
  chipText: { color: TEAL, fontWeight: "700", fontSize: 14.5 },
  chipTextOn: { color: "#FFFFFF" },
  toggleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  remove: { color: "#B3261E", fontWeight: "700", fontSize: 15 },
  addButton: { borderWidth: 1.5, borderColor: TEAL, borderRadius: 12, paddingVertical: 13, alignItems: "center", backgroundColor: "#FFFFFF" },
  addText: { color: TEAL, fontWeight: "800", fontSize: 16 },
  prefill: { backgroundColor: "#E6F4F6", borderRadius: 12, padding: 14 },
  prefillText: { color: NAVY, fontWeight: "700", fontSize: 15.5 },
  candidate: { borderWidth: 1.5, borderColor: "#C9D6E2", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  candidateOn: { borderColor: TEAL, backgroundColor: "#E6F4F6" },
  candidateText: { fontSize: 15.5, color: NAVY, fontWeight: "600" },
});
