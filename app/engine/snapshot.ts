// Household snapshot and what-if scenarios - TS port of snapshot.py.
// change_withholding applies (prototype bug fixed in both engines).
// Snapshot state model is Arizona only in Phase 1; other states throw.
import { computeFederalTax, computeNiit } from "./federal.ts";
import { round2 } from "./packs.ts";
import { computeArizonaTax } from "./state.ts";

export interface HouseholdTaxSnapshot {
  filingStatus: string; grossIncome: number; ltcgIncome: number;
  federalWithholdingYtd: number; stateWithholdingYtd: number;
  federalTax: number; federalRefundOwe: number; stateTax: number; stateRefundOwe: number;
  niit: number; totalTax: number; effectiveRate: number; marginalRate: number;
  distanceToNextBracket: number; nextBracketRate: number;
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
): HouseholdTaxSnapshot {
  if (state.toUpperCase() !== "AZ") {
    throw new Error(`Snapshot state model is Arizona only in Phase 1 (got ${state}). Full state packs arrive per PHASE1.md sequencing.`);
  }
  const federal = computeFederalTax(grossIncome, filingStatus, ltcgIncome, itemizedDeductions);
  const magiValue = magi ?? grossIncome;
  const niit = computeNiit(magiValue, netInvestmentIncome, filingStatus);
  const stateTax = computeArizonaTax(grossIncome);
  return {
    filingStatus, grossIncome, ltcgIncome, federalWithholdingYtd, stateWithholdingYtd,
    federalTax: federal.totalTax,
    federalRefundOwe: federalWithholdingYtd - federal.totalTax,
    stateTax,
    stateRefundOwe: stateWithholdingYtd - stateTax,
    niit,
    totalTax: federal.totalTax + niit + stateTax,
    effectiveRate: federal.effectiveRate,
    marginalRate: federal.marginalRate,
    distanceToNextBracket: federal.distanceToNextBracket,
    nextBracketRate: federal.nextBracketRate,
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
