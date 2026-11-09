// Round 49 golden checks: the quick estimate, the exceptions overlays
// on the round-48 category model, Home's spending precedence, and the
// Social Security statement fallback. Run: node engine-tests/round49.ts
import {
  chooseSpending,
  lifestyleBreakdown,
  lifestyleEffective,
  quickBreakdown,
  ssForMember,
} from "../src/goals.ts";

let checks = 0;
let failures = 0;
function eq(label: string, actual: number, expected: number) {
  checks++;
  if (actual !== expected) {
    failures++;
    console.log(`FAIL ${label}: got ${actual}, want ${expected}`);
  }
}
function eqs(label: string, actual: string, expected: string) {
  checks++;
  if (actual !== expected) {
    failures++;
    console.log(`FAIL ${label}: got ${actual}, want ${expected}`);
  }
}

// --- quickBreakdown: the brief's case --------------------------------
const qb = quickBreakdown({
  monthlySpend: 10000,
  mortgageEndsMonthly: 1500,
  collegeEndsAnnual: 12000,
  travelAdjustPct: -5, // Less
  healthcareBridgeAnnual: 9000,
  done: true,
});
eq("quick currentSpending", qb.currentSpending, 120000);
eq("quick endingTotal", qb.endingTotal, 30000);
eq("quick travelDelta", qb.travelDelta, -6000);
eq("quick lifestyleAnnual", qb.lifestyleAnnual, 93000);

// --- lifestyleEffective: overlays on the round-48 composed lifestyle --
const composed = {
  amounts: { housing: 36000, food: 18000, travel: 12000, healthcare: 8000, k401: 41400, payroll_taxes: 30000 },
  states: { food: "changes", travel: "ends" } as Record<string, "continues" | "ends" | "changes">,
  adjusted: { food: 15000 },
  additionsAnnual: 6000,
  confirmed: false,
};
eq("composed base lifestyleAnnual", lifestyleBreakdown(composed).lifestyleAnnual, 65000);
const exceptions = {
  mortgageAtRetirement: "ends" as const,
  mortgageMonthly: 1000,
  collegeContinuesAnnual: 5000,
  healthcareBridgeAnnual: 8000,
  majorChangeAnnual: -3000,
  travel: "" as const,
};
const eff = lifestyleEffective(composed, exceptions);
eq("overlay mortgageOverlay", eff.mortgageOverlay, 12000);
eq("overlay collegeContinues", eff.collegeContinues, 5000);
eq("overlay healthcareBridge", eff.healthcareBridge, 8000);
eq("overlay majorChange", eff.majorChange, -3000);
eq("overlay lifestyleAnnual", eff.lifestyleAnnual, 63000);
eq("overlay endingTotal (83400 + 12000)", eff.endingTotal, 95400);

// Guard case: the housing row already ends, so the mortgage overlay is
// skipped (never subtracted twice) and the base is read against the
// row's continues value: 65000 + 5000 + 8000 - 3000 = 75000.
const housingEnds = { ...composed, states: { ...composed.states, housing: "ends" as const } };
const effGuard = lifestyleEffective(housingEnds, exceptions);
eq("guard mortgageOverlay skipped", effGuard.mortgageOverlay, 0);
eq("guard housingRestored", effGuard.housingRestored, 36000);
eq("guard lifestyleAnnual", effGuard.lifestyleAnnual, 75000);

// No exceptions answered: the effective figure is the breakdown itself.
const effNone = lifestyleEffective(composed, {
  mortgageAtRetirement: "",
  mortgageMonthly: 0,
  collegeContinuesAnnual: 0,
  healthcareBridgeAnnual: 0,
  majorChangeAnnual: 0,
  travel: "",
});
eq("no exceptions lifestyleAnnual", effNone.lifestyleAnnual, 65000);
eq("no exceptions endingTotal", effNone.endingTotal, 83400);

// --- Spending precedence / tiers --------------------------------------
const FALLBACK = 341566;
const noQuick = { monthlySpend: 0, mortgageEndsMonthly: 0, collegeEndsAnnual: 0, travelAdjustPct: 0, healthcareBridgeAnnual: 0, done: false };
const quickDone = { monthlySpend: 10000, mortgageEndsMonthly: 1500, collegeEndsAnnual: 12000, travelAdjustPct: -5, healthcareBridgeAnnual: 9000, done: true };
const noEx = { mortgageAtRetirement: "" as const, mortgageMonthly: 0, collegeContinuesAnnual: 0, healthcareBridgeAnnual: 0, majorChangeAnnual: 0, travel: "" as const };
const baseChoice = { lifestyle: composed, exceptions: noEx, customAnnual: 0, budgetTotal: 0, quick: noQuick, fallback: FALLBACK };

const cNone = chooseSpending(baseChoice);
eqs("tier none", cNone.tier, "none");
eq("tier none figure is the fallback", cNone.spendingAnnual, FALLBACK);

const cQuick = chooseSpending({ ...baseChoice, quick: quickDone });
eqs("tier quick", cQuick.tier, "quick");
eq("tier quick figure", cQuick.spendingAnnual, 93000);

const cBudget = chooseSpending({ ...baseChoice, quick: quickDone, budgetTotal: 80000 });
eqs("budget beats quick", cBudget.tier, "set");
eq("budget figure", cBudget.spendingAnnual, 80000);

const cCustom = chooseSpending({ ...baseChoice, quick: quickDone, budgetTotal: 80000, customAnnual: 90000 });
eqs("custom beats budget", cCustom.tier, "set");
eq("custom figure", cCustom.spendingAnnual, 90000);

const cConfirmed = chooseSpending({ ...baseChoice, lifestyle: { ...composed, confirmed: true }, customAnnual: 90000, budgetTotal: 80000, quick: quickDone });
eqs("confirmed beats custom", cConfirmed.tier, "confirmed");
eq("confirmed figure is the lifestyle figure", cConfirmed.spendingAnnual, 65000);

// --- Social Security statement fallback --------------------------------
const ssaDoc = {
  docType: "ssa_statement",
  ownerMemberId: "member-a",
  capturedOn: "2026-11-02",
  fields: { monthly_benefit_estimate: "2800" },
};
const fromStmt = ssForMember({ id: "member-a", ssAnnual: 0 }, [ssaDoc]);
eq("SS from statement annual", fromStmt.annual, 33600);
eqs("SS from statement source", fromStmt.source, "statement");
const manualWins = ssForMember({ id: "member-a", ssAnnual: 40000 }, [ssaDoc]);
eq("SS manual wins annual", manualWins.annual, 40000);
eqs("SS manual wins source", manualWins.source, "manual");
const otherMember = ssForMember({ id: "member-b", ssAnnual: 0 }, [ssaDoc]);
eq("SS statement is owner-scoped", otherMember.annual, 0);
const noStmt = ssForMember({ id: "member-a", ssAnnual: 0 }, []);
eqs("SS no data source", noStmt.source, "none");
// The freshest statement wins when two exist for the same member.
const older = { ...ssaDoc, capturedOn: "2025-03-01", fields: { monthly_benefit_estimate: "2500" } };
eq("SS freshest statement wins", ssForMember({ id: "member-a", ssAnnual: 0 }, [older, ssaDoc]).annual, 33600);
eq("SS freshest statement wins (reversed)", ssForMember({ id: "member-a", ssAnnual: 0 }, [ssaDoc, older]).annual, 33600);

console.log(`round49: ${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
