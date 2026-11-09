// The visual retirement timeline (round 53, item 2) - pure React
// Native Views, no chart library, no svg. One row per adult against
// a shared age axis: a navy dot for TODAY, a teal diamond for the
// GOAL (desired retirement age), and on the reference adult's row a
// thick CURRENT PATH band spanning the reach range in the status
// color. Milestone chips sit below, and every chip comes from data
// the model actually has (see retirementTimelineModel) - no chip is
// ever invented.
//
// Round 54 (device QA): the tick strip is laid out by the pure
// collision-aware timelineLabelLayout in goals.ts - labels carry
// their own boxes, so the goal label can no longer land on a decade
// tick and the range label can no longer land on the end tick. A
// fully unreached path draws a faded run-off segment over the last
// part of the axis with its "80+" label above the axis end, instead
// of the solid pill at the edge that read as a stray toggle. The
// legend glyphs are drawn shapes in fixed-width slots, so no glyph
// can crowd the word next to it.
import React, { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  TIMELINE_REF_WIDTH,
  timelineLabelLayout,
  type RetirementTimeline as TimelineModel,
  type StatusColorKey,
} from "../goals.ts";

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

  // Label layout at the model's canonical width until the strip has
  // been measured, then at the measured width - same pure function.
  const [axisW, setAxisW] = useState(0);
  const labels = useMemo(() => {
    if (!reference || axisW <= 0) return timeline.labels;
    return timelineLabelLayout({ minAge, maxAge, ticks, goalAge: reference.desiredAge, band, axisWidth: axisW });
  }, [axisW, timeline, reference, minAge, maxAge, ticks, band]);
  const denom = axisW > 0 ? axisW : TIMELINE_REF_WIDTH;
  const stripLabels = labels.filter((l) => l.placement === "strip" && !l.dropped);
  const aboveLabel = labels.find((l) => l.placement === "above" && !l.dropped) ?? null;

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
            {r.isReference && (band.fadedStartAge !== null ? (
              <View
                style={[
                  styles.band,
                  styles.bandFaded,
                  {
                    top: trackH / 2 - 5,
                    left: `${pct(band.fadedStartAge)}%`,
                    width: `${100 - pct(band.fadedStartAge)}%`,
                    backgroundColor: bandColor,
                  },
                ]}
              >
                <Text style={styles.bandArrow}>{"›"}</Text>
              </View>
            ) : (
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
            ))}
            <View style={[styles.todayDot, { top: trackH / 2 - 6, left: `${pct(r.currentAge)}%` }]} />
            <View style={[styles.goalMarker, { top: trackH / 2 - 6, left: `${pct(r.desiredAge)}%` }]} />
          </View>
        </View>
      ))}
      {aboveLabel && (
        <View style={styles.aboveRow}>
          <Text style={[styles.aboveLabel, { color: bandColor }]}>{aboveLabel.text}</Text>
        </View>
      )}
      <View
        style={styles.tickStrip}
        onLayout={(e) => {
          const w = Math.round(e.nativeEvent.layout.width);
          if (w > 0 && w !== axisW) setAxisW(w);
        }}
      >
        {stripLabels.map((l) => (
          <Text
            key={`${l.kind}:${l.text}:${l.anchorAge}`}
            style={[
              styles.tickLabel,
              {
                left: `${(l.left / denom) * 100}%`,
                width: `${((l.right - l.left) / denom) * 100}%`,
                textAlign: l.align,
              },
              l.kind === "goal" ? styles.goalTick : null,
              l.kind === "range" ? { color: bandColor, fontWeight: "800" as const } : null,
            ]}
          >
            {l.text}
          </Text>
        ))}
      </View>
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={styles.legendSlot}>
            <View style={styles.legendDot} />
          </View>
          <Text style={styles.legendText}>today</Text>
        </View>
        <Text style={styles.legendSep}>·</Text>
        <View style={styles.legendItem}>
          <View style={styles.legendSlot}>
            <View style={styles.legendDiamond} />
          </View>
          <Text style={styles.legendText}>goal</Text>
        </View>
        <Text style={styles.legendSep}>·</Text>
        <View style={styles.legendItem}>
          <View style={styles.legendSlot}>
            <View style={[styles.legendSwatch, { backgroundColor: bandColor }]} />
          </View>
          <Text style={styles.legendText}>the colored band is the current path</Text>
        </View>
      </View>
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
  bandFaded: { opacity: 0.45, borderTopLeftRadius: 0, borderBottomLeftRadius: 0 },
  bandArrow: { position: "absolute", right: 2, fontSize: 13, fontWeight: "900", color: "#FFFFFF", lineHeight: 13 },
  todayDot: { position: "absolute", width: 12, height: 12, borderRadius: 6, backgroundColor: NAVY, marginLeft: -6, borderWidth: 2, borderColor: "#FFFFFF" },
  goalMarker: {
    position: "absolute", width: 12, height: 12, backgroundColor: TEAL, marginLeft: -6,
    transform: [{ rotate: "45deg" }], borderWidth: 2, borderColor: "#FFFFFF",
  },
  aboveRow: { marginHorizontal: 2, marginTop: 1, alignItems: "flex-end" },
  aboveLabel: { fontSize: 12, fontWeight: "800" },
  tickStrip: { position: "relative", height: 20, marginHorizontal: 2, marginTop: 2 },
  tickLabel: { position: "absolute", fontSize: 12, color: MUTED, fontWeight: "600" },
  goalTick: { color: TEAL, fontWeight: "800" },
  legendRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 6, marginTop: 3 },
  legendItem: { flexDirection: "row", alignItems: "center" },
  legendSlot: { width: 20, alignItems: "center", justifyContent: "center", marginRight: 4 },
  legendDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: NAVY },
  legendDiamond: { width: 10, height: 10, backgroundColor: TEAL, transform: [{ rotate: "45deg" }] },
  legendSwatch: { width: 16, height: 8, borderRadius: 4 },
  legendText: { fontSize: 12.5, color: MUTED },
  legendSep: { fontSize: 12.5, color: MUTED },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  chip: { backgroundColor: "#EEF4F8", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { fontSize: 13, fontWeight: "700", color: NAVY },
});
