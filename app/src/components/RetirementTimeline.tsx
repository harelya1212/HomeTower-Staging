// The visual retirement timeline (round 53, item 2) - pure React
// Native Views, no chart library, no svg. One row per adult against
// a shared age axis: a navy dot for TODAY, a teal diamond for the
// GOAL (desired retirement age), and on the reference adult's row a
// thick CURRENT PATH band spanning the reach range in the status
// color (running to the axis end with an arrow when the path is
// unreached, "80+"). Age ticks under the axis carry the goal age and
// the range label; milestone chips sit below, and every chip comes
// from data the model actually has (see retirementTimelineModel) -
// no chip is ever invented.
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { RetirementTimeline as TimelineModel, StatusColorKey } from "../goals.ts";

const NAVY = "#12355B";
const TEAL = "#0E7C7B";
const MUTED = "#5A6B7D";
const TRACK_LINE = "#D5DEE8";

const STATUS_HEX: Record<StatusColorKey, string> = {
  green: "#1E8E3E",
  yellow: "#F2A900",
  orange: "#E37400",
  red: "#C5221F",
};

export default function RetirementTimeline({ timeline, colorKey, compact }: {
  timeline: TimelineModel;
  colorKey: StatusColorKey;
  compact?: boolean;
}) {
  const { minAge, maxAge, rows, band, chips, ticks } = timeline;
  const span = Math.max(1, maxAge - minAge);
  const pct = (age: number) => Math.max(0, Math.min(100, ((age - minAge) / span) * 100));
  const bandColor = STATUS_HEX[colorKey];
  const reference = rows.find((r) => r.isReference) ?? rows[0];
  const trackH = compact ? 30 : 38;
  return (
    <View style={compact ? styles.wrapCompact : styles.wrap}>
      {rows.map((r) => (
        <View key={r.name + r.currentAge} style={styles.rowBlock}>
          <View style={styles.rowHead}>
            <Text style={styles.rowName}>{r.firstName}</Text>
            <Text style={styles.rowMeta}>today {r.currentAge} · goal {r.desiredAge}</Text>
          </View>
          <View style={[styles.track, { height: trackH }]}>
            <View style={[styles.baseline, { top: trackH / 2 - 1 }]} />
            {r.isReference && (
              <View
                style={[
                  styles.band,
                  {
                    top: trackH / 2 - 5,
                    left: `${pct(band.startAge)}%`,
                    width: `${Math.max(3, pct(band.endAge) - pct(band.startAge))}%`,
                    backgroundColor: bandColor,
                  },
                ]}
              >
                {band.unreached && <Text style={styles.bandArrow}>{"›"}</Text>}
              </View>
            )}
            <View style={[styles.todayDot, { top: trackH / 2 - 6, left: `${pct(r.currentAge)}%` }]} />
            <View style={[styles.goalMarker, { top: trackH / 2 - 6, left: `${pct(r.desiredAge)}%` }]} />
          </View>
        </View>
      ))}
      <View style={styles.tickStrip}>
        {ticks.map((t) => (
          <Text key={t} style={[styles.tickLabel, { left: `${pct(t)}%` }]}>{t}</Text>
        ))}
        {reference && (
          <Text style={[styles.tickLabel, styles.goalTick, { left: `${pct(reference.desiredAge)}%` }]}>
            Goal {reference.desiredAge}
          </Text>
        )}
        <Text
          style={[
            styles.tickLabel,
            styles.rangeTick,
            { left: `${pct((band.startAge + band.endAge) / 2)}%`, color: bandColor },
          ]}
        >
          {band.label}
        </Text>
        <Text style={[styles.tickLabel, styles.endTick]}>80+</Text>
      </View>
      <Text style={styles.legend}>
        <Text style={{ color: NAVY }}>{"●"}</Text> today · <Text style={{ color: TEAL }}>{"◆"}</Text> goal · the colored band is the current path
      </Text>
      {chips.length > 0 && (
        <View style={styles.chipsRow}>
          {chips.map((c) => (
            <View key={c.label} style={styles.chip}>
              <Text style={styles.chipText}>{c.label}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 10, marginBottom: 4 },
  wrapCompact: { marginTop: 8, marginBottom: 2 },
  rowBlock: { marginBottom: 2 },
  rowHead: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  rowName: { fontSize: 15, fontWeight: "800", color: NAVY },
  rowMeta: { fontSize: 13, color: MUTED, fontWeight: "600" },
  track: { position: "relative", marginHorizontal: 2 },
  baseline: { position: "absolute", left: 0, right: 0, height: 2, backgroundColor: TRACK_LINE, borderRadius: 1 },
  band: { position: "absolute", height: 10, borderRadius: 5, justifyContent: "center" },
  bandArrow: { position: "absolute", right: 2, fontSize: 13, fontWeight: "900", color: "#FFFFFF", lineHeight: 13 },
  todayDot: { position: "absolute", width: 12, height: 12, borderRadius: 6, backgroundColor: NAVY, marginLeft: -6, borderWidth: 2, borderColor: "#FFFFFF" },
  goalMarker: {
    position: "absolute", width: 12, height: 12, backgroundColor: TEAL, marginLeft: -6,
    transform: [{ rotate: "45deg" }], borderWidth: 2, borderColor: "#FFFFFF",
  },
  tickStrip: { position: "relative", height: 20, marginHorizontal: 2, marginTop: 2 },
  tickLabel: { position: "absolute", fontSize: 12, color: MUTED, fontWeight: "600", transform: [{ translateX: -8 }] },
  goalTick: { color: TEAL, fontWeight: "800" },
  rangeTick: { fontWeight: "800", transform: [{ translateX: -14 }] },
  endTick: { right: 0, transform: [{ translateX: 0 }], fontWeight: "800" },
  legend: { fontSize: 12.5, color: MUTED, marginTop: 2 },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  chip: { backgroundColor: "#EEF4F8", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { fontSize: 13, fontWeight: "700", color: NAVY },
});
