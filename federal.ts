// Federal tax math - TypeScript port of the Python reference engine
// (engine/hometower_engine/federal.py). Verified against shared golden
// vectors in ../engine-tests.
import { brackets, federalPack, round2, type Bracket, type Pack } from "./packs.ts";

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

export interface NiitBreakdown {
  niiSubject: number;
  magiExcess: number;
  base: number;
  niit: number;
}

/** The NIIT base, shown not hidden (engine round 45): the tax is
 * 3.8% of the LESSER of net investment income and the MAGI excess
 * over the threshold - a $0 result must say which side bound it. */
export function niitBreakdown(magi: number, netInvestmentIncome: number, status: string, pack: Pack = federalPack()): NiitBreakdown {
  const threshold = pack.niit.threshold[status] ?? 250000;
  const excess = Math.max(0, magi - threshold);
  const base = Math.min(Math.max(0, netInvestmentIncome), excess);
  return { niiSubject: round2(Math.max(0, netInvestmentIncome)), magiExcess: round2(excess), base: round2(base), niit: round2(base * pack.niit.rate) };
}

export interface AdditionalMedicare {
  liability: number;       // 0.9% of household Medicare wages over the status threshold
  withheldCredit: number;  // the Additional-Medicare part already withheld (over the 1.45% base)
  net: number;             // liability - withheldCredit; the only part that moves refund/owe
  medicareWages: number;   // household total the liability ran on
}

/** Additional Medicare Tax (IRC 3101(b)(2)), engine round 45.
 * Liability is a HOUSEHOLD test: 0.9% of total Medicare wages over
 * the filing-status threshold. The withholding credit is per earner
 * and is NOT the employer's total Medicare withholding: it is only
 * the part above the 1.45% base rate (employers start the extra
 * 0.9% once an earner's wages pass $200K; on the return the credit
 * is exactly that excess). Crediting the FULL liability without the
 * withheld side - or the reverse - is the error this exists to
 * prevent. Mirror of federal.py compute_additional_medicare. */
export function computeAdditionalMedicare(medicareWagesByEarner: number[], medicareWithheldByEarner: number[], status: string, pack: Pack = federalPack()): AdditionalMedicare {
  const cfg = pack.additional_medicare;
  const threshold = cfg.liability_threshold[status] ?? 250000;
  const totalWages = medicareWagesByEarner.reduce((a, b) => a + b, 0);
  const liability = cfg.rate * Math.max(0, totalWages - threshold);
  let credit = 0;
  medicareWagesByEarner.forEach((wages, i) => {
    credit += Math.max(0, (medicareWithheldByEarner[i] ?? 0) - cfg.base_rate * wages);
  });
  return { liability: round2(liability), withheldCredit: round2(credit), net: round2(liability - credit), medicareWages: round2(totalWages) };
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
