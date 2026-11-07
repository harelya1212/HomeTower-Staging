// Federal tax math - TypeScript port of the Python reference engine
// (engine/hometower_engine/federal.py). Verified against shared golden
// vectors in ../engine-tests.
import { brackets, federalPack, type Bracket, type Pack } from "./packs.ts";

export const DEFAULT_STATUS = "married_filing_jointly";

function ordinaryBrackets(status: string, pack: Pack): Bracket[] {
  return brackets(pack.ordinary_brackets[status] ?? pack.ordinary_brackets[DEFAULT_STATUS]);
}
function ltcgBrackets(status: string, pack: Pack): Bracket[] {
  return brackets(pack.ltcg_brackets[status] ?? pack.ltcg_brackets[DEFAULT_STATUS]);
}

export function computeOrdinaryTax(taxableIncome: number, status: string, pack: Pack = federalPack()): number {
  let tax = 0;
  for (const [low, high, rate] of ordinaryBrackets(status, pack)) {
    if (taxableIncome <= low) break;
    tax += (Math.min(taxableIncome, high) - low) * rate;
  }
  return tax;
}

export function computeLtcgTax(ltcgAmount: number, taxableBefore: number, status: string, pack: Pack = federalPack()): number {
  let tax = 0;
  const base = taxableBefore;
  const remaining = ltcgAmount;
  for (const [low, high, rate] of ltcgBrackets(status, pack)) {
    const space = Math.max(0, Math.min(high, base + remaining) - Math.max(low, base));
    if (space > 0) tax += space * rate;
  }
  return tax;
}

export function marginalRate(taxableIncome: number, status: string, pack: Pack = federalPack()): number {
  for (const [low, high, rate] of ordinaryBrackets(status, pack)) {
    if (low <= taxableIncome && taxableIncome < high) return rate;
  }
  return 0.37;
}

export function distanceToNextBracket(taxableIncome: number, status: string, pack: Pack = federalPack()): [number, number] {
  for (const [low, high, rate] of ordinaryBrackets(status, pack)) {
    if (low <= taxableIncome && taxableIncome < high) {
      if (high === Infinity) return [0, rate];
      return [high - taxableIncome, rate];
    }
  }
  return [0, 0.37];
}

export function computeNiit(magi: number, netInvestmentIncome: number, status: string, pack: Pack = federalPack()): number {
  const threshold = pack.niit.threshold[status] ?? 250000;
  if (magi <= threshold || netInvestmentIncome <= 0) return 0;
  return Math.min(netInvestmentIncome, magi - threshold) * pack.niit.rate;
}

export interface FederalTaxResult {
  grossIncome: number;
  standardDeduction: number;
  taxableIncome: number;
  ordinaryTax: number;
  ltcgTax: number;
  totalTax: number;
  effectiveRate: number;
  marginalRate: number;
  distanceToNextBracket: number;
  nextBracketRate: number;
}

export function computeFederalTax(
  grossIncome: number,
  status: string,
  ltcgIncome = 0,
  itemizedDeductions = 0,
  pack: Pack = federalPack(),
): FederalTaxResult {
  const std = pack.standard_deduction[status] ?? 32200;
  const deduction = Math.max(std, itemizedDeductions);
  const taxableIncome = Math.max(0, grossIncome - deduction);
  const ordinaryTaxable = Math.max(0, taxableIncome - ltcgIncome);
  const ordinaryTax = computeOrdinaryTax(ordinaryTaxable, status, pack);
  const ltcgTax = ltcgIncome > 0 ? computeLtcgTax(ltcgIncome, ordinaryTaxable, status, pack) : 0;
  const total = ordinaryTax + ltcgTax;
  const [dist, nextRate] = distanceToNextBracket(ordinaryTaxable, status, pack);
  return {
    grossIncome,
    standardDeduction: deduction,
    taxableIncome,
    ordinaryTax,
    ltcgTax,
    totalTax: total,
    effectiveRate: grossIncome > 0 ? total / grossIncome : 0,
    marginalRate: marginalRate(ordinaryTaxable, status, pack),
    distanceToNextBracket: dist,
    nextBracketRate: nextRate,
  };
}
