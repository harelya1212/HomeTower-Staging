import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

export const GREEN = "#1E8E3E";
export const YELLOW = "#E37400";
export const RED = "#C5221F";
export const TRACK = "#E3EAF1";

/** Linear gauge for a refund/owe value against a target band.
 * Scale: [min .. max] where min covers the owe zone and max gives the
 * over-withheld zone room. Zones: red below $0 (owe), pale to the band,
 * green inside the band, amber above it. Break-even $0 is a tick. */
export function RefundGauge({ value, low, high }: { value: number; low: number; high: number }) {
  const min = Math.min(-1000, value * 1.2, low - 2000);
  const max = Math.max(high * 1.6, value * 1.2, high + 2000);
  const pos = (x: number): `${number}%` => `${Math.max(0, Math.min(100, ((x - min) / (max - min)) * 100))}%` as `${number}%`;
  const inBand = value >= low && value <= high;
  const color = inBand ? GREEN : value < low ? RED : YELLOW;
  return (
    <View>
      <View style={styles.track}>
        <View style={[styles.zone, { left: pos(min), width: pos(0), backgroundColor: "#F5C6C4" }]} />
        <View style={[styles.zone, { left: pos(low), width: pos(high - low + min) as `${number}%`, backgroundColor: "#B7E1C0" }]} />
        <View style={[styles.zeroTick, { left: pos(0) }]} />
        <View style={[styles.marker, { left: pos(value), backgroundColor: color }]} />
      </View>
      <View style={styles.scaleRow}>
        <Text style={[styles.scaleText, { flex: 1, textAlign: "left" }]}>Owe</Text>
        <Text style={[styles.scaleText, { flex: 1.4, textAlign: "center" }]}>$0 break-even</Text>
        <Text style={[styles.scaleText, { flex: 1.6, textAlign: "right" }]}>{"Target $" + low.toLocaleString() + " - $" + high.toLocaleString()}</Text>
      </View>
    </View>
  );
}

/** Circular percentage ring. pct may exceed 100 (shown capped visually,
 * number stays honest). */
export function RingGauge({ pct, label, color }: { pct: number; label: string; color: string }) {
  const size = 116;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const shown = Math.max(0, Math.min(100, pct));
  return (
    <View style={styles.ringWrap}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={TRACK} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${(shown / 100) * c} ${c}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={styles.ringCenter}>
        <Text style={[styles.ringValue, { color }]}>{pct}%</Text>
      </View>
      <Text style={styles.ringLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 18, borderRadius: 999, backgroundColor: "#EDF2F6", position: "relative", overflow: "hidden", marginVertical: 8 },
  zone: { position: "absolute", top: 0, bottom: 0 },
  zeroTick: { position: "absolute", top: 0, bottom: 0, width: 2, backgroundColor: "#5A6B7C" },
  marker: { position: "absolute", top: 2, bottom: 2, width: 6, borderRadius: 3, marginLeft: -3 },
  scaleRow: { flexDirection: "row", justifyContent: "space-between" },
  scaleText: { fontSize: 12, color: "#5A6B7C", fontWeight: "600" },
  ringWrap: { alignItems: "center", width: 120 },
  ringCenter: { position: "absolute", top: 0, width: 116, height: 116, alignItems: "center", justifyContent: "center" },
  ringValue: { fontSize: 27, fontWeight: "800" },
  ringLabel: { fontSize: 13.5, fontWeight: "700", color: "#22303C", textAlign: "center", marginTop: 3, lineHeight: 18 },
});
