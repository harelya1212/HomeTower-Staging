// Shared form controls (owner QA round 3, 2026-11-07).
//
// TextField: a text input with a LOCAL buffer. The store value can never
// clobber what the user is typing mid-keystroke, and the buffer survives
// parent re-renders - the household-name field appeared uneditable
// because the tab label (which reads the same store value) recreated
// the navigator options on every keystroke.
//
// DateField: US format MM/DD/YYYY on screen (auto-slash masking, numeric
// keyboard), ISO YYYY-MM-DD in storage - the engine and age math keep
// working on ISO, the user never sees it.
//
// StatePicker: the state of residence is CHOSEN from the 50 states + DC,
// never typed freehand.
import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, type KeyboardTypeOptions } from "react-native";
import { NAVY, TEAL } from "../screens/HomeScreen.tsx";

const inputStyle = { backgroundColor: "#F4F7FA", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, fontSize: 17 } as const;

interface TextFieldProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  maxLength?: number;
}

export function TextField({ value, onChange, placeholder, keyboardType, autoCapitalize, maxLength }: TextFieldProps) {
  const [text, setText] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);
  return (
    <TextInput
      style={inputStyle}
      value={text}
      placeholder={placeholder}
      keyboardType={keyboardType}
      autoCapitalize={autoCapitalize}
      maxLength={maxLength}
      onFocus={() => { focused.current = true; }}
      onBlur={() => { focused.current = false; onChange(text); }}
      onChangeText={(v) => { setText(v); onChange(v); }}
    />
  );
}

export function isoToUs(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : "";
}

export function usToIso(us: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(us.trim());
  if (!m) return null;
  const mo = Number(m[1]);
  const d = Number(m[2]);
  const y = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return `${m[3]}-${m[1]}-${m[2]}`;
}

function maskUs(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

interface DateFieldProps {
  value: string; // ISO YYYY-MM-DD or ""
  onChange: (iso: string) => void;
  placeholder?: string;
}

export function DateField({ value, onChange, placeholder }: DateFieldProps) {
  const [text, setText] = useState(() => isoToUs(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(isoToUs(value));
  }, [value]);
  const invalid = text.length > 0 && usToIso(text) === null && text.replace(/\D/g, "").length >= 8;
  return (
    <View>
      <TextInput
        style={inputStyle}
        value={text}
        placeholder={placeholder ?? "MM/DD/YYYY"}
        keyboardType="numeric"
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; setText(isoToUs(value)); }}
        onChangeText={(v) => {
          const masked = maskUs(v);
          setText(masked);
          if (masked === "") { onChange(""); return; }
          const iso = usToIso(masked);
          if (iso) onChange(iso);
        }}
      />
      {invalid && <Text style={styles.dateHint}>Use MM/DD/YYYY - for example 09/26/1977</Text>}
    </View>
  );
}

export const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
  "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM",
  "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA",
  "WV", "WI", "WY",
];

interface StatePickerProps {
  value: string;
  onChange: (v: string) => void;
}

export function StatePicker({ value, onChange }: StatePickerProps) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Pressable style={styles.stateRow} onPress={() => setOpen(true)}>
        <Text style={styles.stateValue}>{value || "Choose"}</Text>
        <Text style={styles.stateChange}>Tap to change</Text>
      </Pressable>
    );
  }
  return (
    <View style={styles.chipWrap}>
      {US_STATES.map((s) => (
        <Pressable
          key={s}
          onPress={() => { onChange(s); setOpen(false); }}
          style={[styles.stateChip, value === s && styles.chipOn]}
        >
          <Text style={[styles.stateChipText, value === s && styles.chipTextOn]}>{s}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  dateHint: { color: "#B3261E", fontSize: 13.5, marginTop: 4 },
  stateRow: { backgroundColor: "#F4F7FA", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  stateValue: { fontSize: 17, fontWeight: "700", color: NAVY },
  stateChange: { fontSize: 14, color: TEAL, fontWeight: "600" },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  stateChip: { borderWidth: 1.5, borderColor: TEAL, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  chipOn: { backgroundColor: TEAL },
  stateChipText: { color: TEAL, fontWeight: "700", fontSize: 14 },
  chipTextOn: { color: "#FFFFFF" },
});
