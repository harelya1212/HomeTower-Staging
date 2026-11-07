import React from "react";
import { StyleSheet, Text, View } from "react-native";

// Fixed ad banner, pinned above the bottom tab bar on every screen
// (owner QA round 1: the in-scroll slot was never seen). Staging shows
// a labelled house placeholder; the native build wires AdMob into this
// same strip. Contextual ads only - no behavioural trackers (trust rules).
export const AD_BANNER_HEIGHT = 54;

export default function AdBanner() {
  return (
    <View style={styles.banner}>
      <Text style={styles.adLabel}>AD</Text>
      <View>
        <Text style={styles.text}>HomeTower is free - supported by ads</Text>
        <Text style={styles.sub}>Ad banner - AdMob wires here in the native build</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { height: AD_BANNER_HEIGHT, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, backgroundColor: "#0B2A4A" },
  adLabel: { fontSize: 10, fontWeight: "800", color: "#FEC72C", letterSpacing: 2, borderWidth: 1, borderColor: "#FEC72C", borderRadius: 4, paddingHorizontal: 4, paddingVertical: 2 },
  text: { fontSize: 13, fontWeight: "600", color: "#FFFFFF" },
  sub: { fontSize: 11, color: "#B9C9D9" },
});
