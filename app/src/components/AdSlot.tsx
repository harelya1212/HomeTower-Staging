import React from "react";
import { StyleSheet, Text, View } from "react-native";

// The ads slot (VISION: revenue from ads only, at natural breaks).
// Staging shows a clearly-labelled house placeholder; the native build
// wires AdMob into this same slot. Per the trust rules: contextual ads
// only, no behavioural trackers inside the authenticated app.
export default function AdSlot() {
  return (
    <View style={styles.slot}>
      <Text style={styles.adLabel}>AD</Text>
      <Text style={styles.text}>HomeTower is free - supported by ads at natural breaks.</Text>
      <Text style={styles.sub}>Ad slot - AdMob wires here in the native build</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { borderWidth: 1, borderStyle: "dashed", borderColor: "#9DB2C3", borderRadius: 12, padding: 12, alignItems: "center", gap: 2, backgroundColor: "#FFFFFF" },
  adLabel: { fontSize: 10, fontWeight: "800", color: "#5A6B7C", letterSpacing: 2 },
  text: { fontSize: 13, color: "#22303C", textAlign: "center" },
  sub: { fontSize: 11, color: "#5A6B7C" },
});
