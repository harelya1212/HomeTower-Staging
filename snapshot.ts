// Household snapshot and what-if scenarios - TS port of snapshot.py.
// change_withholding applies (prototype bug fixed in both engines).
// Snapshot state model is Arizona only in Phase 1; other states throw.
import { computeAdditionalMedicare, computeFederalTax, niitBreakdown } from "./federal.ts";
import { round2 } from "./packs.ts";
import { computeArizonaTax } from "./state.ts";

export interface HouseholdTaxSnapshot {
  filingStatus: string; grossIncome: number; ltcgIncome: number;
  federalWithholdingYtd: number; stateWithholdingYtd: number;
  federalTax: number; federalRefundOwe: number; stateTax: number; stateRefundOwe: number;
  niit: number; totalTax: number; effectiveRate: number; marginalRate: number;
  distanceToNextBracket: number; nextBracketRate: number;
  // Engine round 45 - the federal reconciliation, shown not hidden.
  // federalTax stays the INCOME tax (the gauge bug of round 44 was
  // conflating it with the all-in figure); totalFederalLiability adds
  // NIIT + Additional Medicare liability; totalFederalPayments adds
  // the Additional-Medicare withheld credit to Box-2 withholding;
  // federalRefundOwe = payments - liability, which reduces to
  // withholding - (income tax + NIIT + AddMed NET).
  additionalMedicareLiability: number;
  additionalMedicareWithheld: number;
  additionalMedicareNet: number;
  federalCredits: number;
  totalFederalLiability: number;
  totalFederalPayments: number;
  niitNiiSubject: number;
  niitMagiExcess: number;
  niitBase: number;
  medicareIncluded: boolean;
}

export function computeHouseholdTax(
  filingStatus: string,
  grossIncome: number,
  federalWithholdingYtd = 0,
  stateWithholdingYtd = 0,
  ltcgIncome = 0,
  magi: number | null = null,
  netInvestmentIncome = 0,
  itemizedDeductions = 0,
  state = "AZ",
  medicareWagesByEarner: number[] | null = null,
  medicareWithheldByEarner: number[] | null = null,
  federalCredits = 0,
): HouseholdTaxSnapshot {
  if (state.toUpperCase() !== "AZ") {
    throw new Error(`Snapshot state model is Arizona only in Phase 1 (got ${state}). Full state packs arrive per PHASE1.md sequencing.`);
  }
  const federal = computeFederalTax(grossIncome, filingStatus, ltcgIncome, itemizedDeductions);
  const magiValue = magi ?? grossIncome;
  const nb = niitBreakdown(magiValue, netInvestmentIncome, filingStatus);
  const niit = nb.niit;
  const stateTax = computeArizonaTax(grossIncome);
  // Additional Medicare enters only when Medicare data is supplied
  // (round 45): absent data keeps every pre-45 figure untouched.
  const medicareIncluded = medicareWagesByEarner !== null;
  let amLiability = 0, amWithheld = 0, amNet = 0;
  if (medicareIncluded) {
    const am = computeAdditionalMedicare(medicareWagesByEarner, medicareWithheldByEarner ?? [], filingStatus);
    amLiability = am.liability; amWithheld = am.withheldCredit; amNet = am.net;
  }
  const totalFederalLiability = federal.totalTax + niit + amLiability - federalCredits;
  const totalFederalPayments = federalWithholdingYtd + amWithheld;
  return {
    filingStatus, grossIncome, ltcgIncome, federalWithholdingYtd, stateWithholdingYtd,
    federalTax: federal.totalTax,
    federalRefundOwe: totalFederalPayments - totalFederalLiability,
    stateTax,
    stateRefundOwe: stateWithholdingYtd - stateTax,
    niit,
    totalTax: federal.totalTax + niit + stateTax,
    effectiveRate: federal.effectiveRate,
    marginalRate: federal.marginalRate,
    distanceToNextBracket: federal.distanceToNextBracket,
    nextBracketRate: federal.nextBracketRate,
    additionalMedicareLiability: amLiability,
    additionalMedicareWithheld: amWithheld,
    additionalMedicareNet: amNet,
    federalCredits,
    totalFederalLiability,
    totalFederalPayments,
    niitNiiSubject: nb.niiSubject,
    niitMagiExcess: nb.magiExcess,
    niitBase: nb.base,
    medicareIncluded,
  };
}

export interface ScenarioInput {
  filingStatus: string;
  baseIncome: number;
  federalWithholdingYtd: number;
  stateWithholdingYtd: number;
  action: "increase_401k" | "change_hsa" | "roth_conversion" | "change_withholding";
  deltaAmount: number;
}

export function simulateScenario(inp: ScenarioInput): Record<string, number | string> {
  const base = computeHouseholdTax(inp.filingStatus, inp.baseIncome, inp.federalWithholdingYtd, inp.stateWithholdingYtd);
  let modifiedIncome = inp.baseIncome;
  let modifiedWithholding = inp.federalWithholdingYtd;
  if (inp.action === "increase_401k" || inp.action === "change_hsa") modifiedIncome -= inp.deltaAmount;
  else if (inp.action === "roth_conversion") modifiedIncome += inp.deltaAmount;
  else if (inp.action === "change_withholding") modifiedWithholding += inp.deltaAmount;
  else throw new Error(`Unknown scenario action: ${inp.action}`);
  const modified = computeHouseholdTax(inp.filingStatus, modifiedIncome, modifiedWithholding, inp.stateWithholdingYtd);
  return {
    base_federal_tax: round2(base.federalTax),
    modified_federal_tax: round2(modified.federalTax),
    federal_tax_delta: round2(modified.federalTax - base.federalTax),
    base_refund_owe: round2(base.federalRefundOwe),
    modified_refund_owe: round2(modified.federalRefundOwe),
    marginal_rate_pct: Math.round(modified.marginalRate * 1000) / 10,
    action: inp.action,
    delta_amount: inp.deltaAmount,
  };
}
