// Round 54 acceptance: device-QA graphics fix for the round-53
// timeline. The owner screenshotted the X card and circled three
// rendering defects: the "Goal 50" label printed on top of the 50
// decade tick, the "80+" range label printed on top of the 80 end
// tick while the fully unreached band degenerated into a clipped
// orange pill at the axis edge, and the legend's goal glyph crowding
// the word "goal". This suite pins the collision-aware label layout
// (goals.ts timelineLabelLayout) and the faded run-off band model.
// Rendering only - no engine number moves.
// Run: node engine-tests/round54.ts
import {
  retirementTimelineModel,
  timelineLabelLayout,
  TIMELINE_REF_WIDTH,
  type TimelineLabel,
} from "../src/goals.ts";

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
}
function ok(name: string, cond: boolean) {
  if (cond) pass++; else { fail++; console.log(`FAIL ${name}`); }
}

const W = TIMELINE_REF_WIDTH;
const kept = (labels: TimelineLabel[]) => labels.filter((l) => !l.dropped);
function noOverlaps(name: string, labels: TimelineLabel[]) {
  const ks = kept(labels);
  let clean = true;
  for (let i = 0; i < ks.length; i++) {
    for (let j = i + 1; j < ks.length; j++) {
      if (ks[i].left < ks[j].right && ks[j].left < ks[i].right) clean = false;
    }
  }
  ok(`${name}: kept label boxes never overlap`, clean);
}
function inBounds(name: string, labels: TimelineLabel[], width: number) {
  ok(`${name}: every kept box inside [0, ${width}]`, kept(labels).every((l) => l.left >= 0 && l.right <= width && l.left < l.right));
}

// ---- (a) The owner's fixture state, through the model --------------
{
  const tl = retirementTimelineModel({
    adults: [
      { name: "Assaf Harel", currentAge: 49, retireAge: 60 },
      { name: "Yamit Harel", currentAge: 47, retireAge: 50 },
    ],
    referenceIndex: 1,
    reach: { r7: null, r6: null, r5: null },
    rangeLabel: "80+",
    ssClaimAges: [],
    mortgageEndsAge: null,
    collegeEnds: [
      { label: "College ends 2029", age: 50 },
      { label: "College ends 2031", age: 52 },
      { label: "College ends 2035", age: 56 },
    ],
  })!;
  ok("owner: timeline builds", tl !== null);
  eq("owner: final label set is Goal 50 / 60 / 70 / 80+",
    kept(tl.labels).map((l) => l.text), ["Goal 50", "60", "70", "80+"]);
  eq("owner: the 50 decade tick yields to the goal label",
    tl.labels.find((l) => l.kind === "tick" && l.anchorAge === 50)?.dropped, true);
  eq("owner: the 80 end tick yields to the range label",
    tl.labels.find((l) => l.kind === "tick" && l.anchorAge === 80)?.dropped, true);
  const range = tl.labels.find((l) => l.kind === "range")!;
  eq("owner: range label sits above the axis end", range.placement, "above");
  eq("owner: range label is right-aligned at the axis end", [range.right, range.align], [W, "right"]);
  noOverlaps("owner", tl.labels);
  inBounds("owner", tl.labels, W);

  // (d) The unreached band model: a faded run-off segment, not a pill.
  ok("owner: faded segment exists", tl.band.fadedStartAge !== null);
  ok("owner: faded segment starts on the axis", (tl.band.fadedStartAge ?? -1) >= tl.minAge);
  eq("owner: faded segment ends at the axis end", tl.band.endAge, tl.maxAge);
  const fadedShare = (tl.maxAge - (tl.band.fadedStartAge ?? tl.maxAge)) / (tl.maxAge - tl.minAge);
  ok("owner: faded segment covers roughly the last 15% of the axis", fadedShare > 0.1 && fadedShare < 0.2);
  eq("owner: band still reads unreached 80+", [tl.band.label, tl.band.unreached], ["80+", true]);
}

// ---- (b) Mid-range: the goal drops its own decade tick -------------
{
  const labels = timelineLabelLayout({
    minAge: 46, maxAge: 82, ticks: [50, 60, 70, 80], goalAge: 60,
    band: { startAge: 64, endAge: 67, label: "64-67", unreached: false, fadedStartAge: null },
    axisWidth: W,
  });
  eq("mid: the 60 tick yields to Goal 60",
    labels.find((l) => l.kind === "tick" && l.anchorAge === 60)?.dropped, true);
  eq("mid: goal and range labels both kept",
    [labels.find((l) => l.kind === "goal")?.dropped, labels.find((l) => l.kind === "range")?.dropped],
    [false, false]);
  eq("mid: kept label texts", kept(labels).map((l) => l.text), ["50", "Goal 60", "64-67", "70", "80+"]);
  eq("mid: range label stays in the strip", labels.find((l) => l.kind === "range")?.placement, "strip");
  noOverlaps("mid", labels);
  inBounds("mid", labels, W);
}

// ---- (c) Reached range next to the goal: labels stay clean ---------
{
  const labels = timelineLabelLayout({
    minAge: 48, maxAge: 82, ticks: [50, 60, 70, 80], goalAge: 65,
    band: { startAge: 61, endAge: 64, label: "61-64", unreached: false, fadedStartAge: null },
    axisWidth: W,
  });
  eq("reached: goal and range labels both kept",
    [labels.find((l) => l.kind === "goal")?.dropped, labels.find((l) => l.kind === "range")?.dropped],
    [false, false]);
  ok("reached: range label present", kept(labels).some((l) => l.text === "61-64"));
  noOverlaps("reached", labels);
  inBounds("reached", labels, W);
}

// ---- (d) Reached and partially reached bands keep the solid path ---
{
  const reached = retirementTimelineModel({
    adults: [{ name: "Solo", currentAge: 45, retireAge: 65 }],
    referenceIndex: 0,
    reach: { r7: 63, r6: 65, r5: 67 },
    rangeLabel: "63-67",
    ssClaimAges: [], mortgageEndsAge: null, collegeEnds: [],
  })!;
  eq("reached: no faded segment", reached.band.fadedStartAge, null);
  eq("reached: solid band span unchanged", [reached.band.startAge, reached.band.endAge], [63, 67]);

  const partial = retirementTimelineModel({
    adults: [{ name: "Solo", currentAge: 50, retireAge: 60 }],
    referenceIndex: 0,
    reach: { r7: 72, r6: 78, r5: null },
    rangeLabel: "72-80+",
    ssClaimAges: [], mortgageEndsAge: null, collegeEnds: [],
  })!;
  eq("partial: no faded segment (solid band to the axis end)", partial.band.fadedStartAge, null);
  eq("partial: solid band span unchanged", [partial.band.startAge, partial.band.endAge, partial.band.unreached], [72, 82, true]);
  noOverlaps("partial", partial.labels);
  inBounds("partial", partial.labels, W);
}

// ---- Layout holds at other widths too ------------------------------
{
  const wide = timelineLabelLayout({
    minAge: 45, maxAge: 82, ticks: [50, 60, 70, 80], goalAge: 50,
    band: { startAge: 80, endAge: 82, label: "80+", unreached: true, fadedStartAge: 76.45 },
    axisWidth: 600,
  });
  noOverlaps("wide", wide);
  inBounds("wide", wide, 600);
  const narrow = timelineLabelLayout({
    minAge: 45, maxAge: 82, ticks: [50, 60, 70, 80], goalAge: 50,
    band: { startAge: 80, endAge: 82, label: "80+", unreached: true, fadedStartAge: 76.45 },
    axisWidth: 280,
  });
  noOverlaps("narrow", narrow);
  inBounds("narrow", narrow, 280);
}

const total = pass + fail;
console.log(fail === 0 ? `ROUND54 OK ${pass}/${total}` : `ROUND54 FAILURES ${fail}/${total}`);
if (fail > 0) process.exit(1);
