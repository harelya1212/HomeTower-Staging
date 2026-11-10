// Per-domain accuracy (round 60, P1-C; Copilot's root-cause
// review). Until this round ONE global number - the intake
// prediction confidence - implicitly governed every module's
// presentation: it scaled the tax gauges' ranges and stood as
// "the" confidence on Home, although it measures DOCUMENT
// COMPLETENESS (payslips / prior return / calibration on file),
// not the accuracy of any one forecast. Now each domain carries
// its own level, computed from its own evidence:
//
// - Federal Tax: its own calibration + payroll evidence.
// - State Tax: the same evidence shape, CAPPED by the state
//   model's honesty (P1-A): while the Arizona model is a
//   flat-rate approximation with no Form 140 logic, the state
//   domain can never claim X++.
// - Retirement: the retirement model's own accuracy
//   (retirementAccuracy) - passed in, never recomputed here, so
//   there is exactly one source for it.
// - Education: whether each child's college costs are real or
//   still the default (the round-59 trace-F gate, as a level).
// - HSA: statement evidence on file, and whether the
//   contribution reconciliation is explained (round 59, trace C).
//
// The global predictionConfidence remains what it always really
// was - a data-completeness indicator - and Home labels it that
// way; it no longer scales any module's numbers.
import { stateTaxModelInfo } from "../engine/state.ts";
import type { HouseholdIntake } from "../engine/intake.ts";
import type { RetirementAccuracyLevel } from "./goals.ts";

export type DomainLevel = RetirementAccuracyLevel;
export interface DomainAccuracyEntry {
  level: DomainLevel;
  label: string; // "Early estimate" | "Planning forecast" | "High-confidence planning forecast"
  basis: string;
}
export interface DomainAccuracyReport {
  federalTax: DomainAccuracyEntry;
  stateTax: DomainAccuracyEntry;
  retirement: DomainAccuracyEntry;
  education: DomainAccuracyEntry | null; // null when there are no children
  hsa: DomainAccuracyEntry;
}

const LABEL: Record<DomainLevel, string> = {
  "X": "Early estimate",
  "X+": "Planning forecast",
  "X++": "High-confidence planning forecast",
};
const entry = (level: DomainLevel, basis: string): DomainAccuracyEntry => ({ level, label: LABEL[level], basis });
const cap = (level: DomainLevel, max: DomainLevel): DomainLevel => {
  const rank: Record<DomainLevel, number> = { "X": 0, "X+": 1, "X++": 2 };
  return rank[level] <= rank[max] ? level : max;
};

export function domainAccuracy(input: {
  intake: HouseholdIntake;
  retirementLevel: DomainLevel;
  eduChildren: { onDefaultCost: boolean }[];
  /** The HSA contribution reconciliation verdict (round 59):
   * true when payroll and the statement agree, false when an
   * unexplained delta stands, null when it cannot be computed. */
  hsaReconExplained: boolean | null;
}): DomainAccuracyReport {
  const docs = input.intake.documents.filter((d) => d.status === "parsed");
  const has = (t: string) => docs.some((d) => d.docType === t);
  const cal = input.intake.calibration ?? null;
  const hasPayslip = has("payslip");
  const hasReturn = has("prior_return");

  // Federal Tax: verified calibration against the actual IRS
  // outcome is the strongest evidence this domain can have.
  const fedVerified = !!(cal && cal.federalFiled && cal.outcomeVerified && cal.actualFederalRefundOwe != null);
  const federalTax = fedVerified && hasPayslip
    ? entry("X++", "Last year's federal outcome is verified against the IRS result, and current payslips are on file.")
    : hasReturn || (hasPayslip && cal?.actualFederalRefundOwe != null)
      ? entry("X+", hasReturn
        ? "Last year's filed return is on file; verifying its actual outcome would sharpen this further."
        : "Current payslips and a recorded outcome are on file; the filed return itself would sharpen this further.")
      : entry("X", hasPayslip
        ? "Current payslips only - no filed return or verified outcome behind the federal forecast yet."
        : "No payslip or filed return behind the federal forecast yet.");

  // State Tax: the same evidence shape through the state's own
  // calibration fields, then the model cap (P1-A).
  const stateVerified = !!(cal && cal.stateFiled && cal.outcomeVerified && cal.actualStateRefundOwe != null);
  let stateLevel: DomainLevel = stateVerified && hasPayslip
    ? "X++"
    : hasReturn || (hasPayslip && cal?.actualStateRefundOwe != null)
      ? "X+"
      : "X";
  const model = stateTaxModelInfo(input.intake.state || "");
  let stateBasis = stateLevel === "X++"
    ? "Last year's state outcome is verified, and current payslips are on file."
    : stateLevel === "X+"
      ? "State evidence on file; verifying last year's actual state outcome would sharpen this further."
      : "Little state evidence behind the state forecast yet.";
  if (!model.fullReturnModeled) {
    stateLevel = cap(stateLevel, "X+");
    stateBasis += ` Capped at X+ while the ${model.state} model is a flat-rate approximation - full return adjustments are not yet modeled.`;
  }
  const stateTax = entry(stateLevel, stateBasis);

  const retirement = entry(input.retirementLevel,
    input.retirementLevel === "X++" ? "Spending, Social Security and pension are all in - the retirement model's own accuracy."
      : input.retirementLevel === "X+" ? "Most retirement inputs are in - the retirement model's own accuracy."
        : "Retirement inputs are still incomplete - the retirement model's own accuracy.");

  let education: DomainAccuracyEntry | null = null;
  if (input.eduChildren.length > 0) {
    const onDefault = input.eduChildren.filter((c) => c.onDefaultCost).length;
    education = onDefault === input.eduChildren.length
      ? entry("X", "Every child's college costs are still the default figure - education figures are early estimates.")
      : onDefault === 0
        ? entry("X++", "Real college costs are on file for every child.")
        : entry("X+", "Real college costs for some children; the rest still run on the default figure.");
  }

  const hsa = hsaAccuracy(has("hsa_statement"), input.hsaReconExplained);

  return { federalTax, stateTax, retirement, education, hsa };
}

/** The HSA domain's level on its own (also used directly by the
 * Documents HSA card, which is where the reconciliation verdict
 * is computed). */
export function hsaAccuracy(hasHsaStatement: boolean, reconExplained: boolean | null): DomainAccuracyEntry {
  return !hasHsaStatement
    ? entry("X", "No HSA statement or account reading on file yet - tax forms alone are history, not current evidence.")
    : reconExplained === true
      ? entry("X++", "An HSA statement is on file and payroll agrees with it - the contribution reconciliation is explained.")
      : reconExplained === false
        ? entry("X+", "An HSA statement is on file, but the contribution reconciliation has an unexplained delta.")
        : entry("X+", "An HSA statement is on file.");
}
