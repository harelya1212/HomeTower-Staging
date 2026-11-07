// Equity compensation: RSU vesting and ESPP dispositions - TS port of
// equity.py. Rules: see the Python module docstring (IRC 423 holding
// tests are day-count based here, 730 / 365).
import { computeFederalTax } from "./federal.ts";
import { daysBetween, round2, type Pack } from "./packs.ts";

export const SUPPLEMENTAL_RATE = 0.22;
export const SUPPLEMENTAL_HIGH_RATE = 0.37;
export const SUPPLEMENTAL_HIGH_THRESHOLD = 1_000_000;

export interface RsuVestResult {
  shares: number; fmvAtVest: number; ordinaryIncome: number; federalWithheld: number;
  projectedAdditionalTax: number; projectedGap: number; lotBasisPerShare: number; holdingStart: string;
}

export function rsuVest(
  shares: number,
  fmvAtVest: number,
  vestDate: string,
  filingStatus: string,
  otherGrossIncome: number,
  supplementalWagesYtdBefore = 0,
  pack?: Pack,
): RsuVestResult {
  const income = shares * fmvAtVest;
  const roomAt22 = Math.max(0, SUPPLEMENTAL_HIGH_THRESHOLD - supplementalWagesYtdBefore);
  const at22 = Math.min(income, roomAt22);
  const withheld = at22 * SUPPLEMENTAL_RATE + (income - at22) * SUPPLEMENTAL_HIGH_RATE;
  const baseTax = computeFederalTax(otherGrossIncome, filingStatus, 0, 0, pack).totalTax;
  const withTax = computeFederalTax(otherGrossIncome + income, filingStatus, 0, 0, pack).totalTax;
  const additional = withTax - baseTax;
  return {
    shares, fmvAtVest,
    ordinaryIncome: round2(income),
    federalWithheld: round2(withheld),
    projectedAdditionalTax: round2(additional),
    projectedGap: round2(additional - withheld),
    lotBasisPerShare: fmvAtVest,
    holdingStart: vestDate,
  };
}

export interface EsppResult {
  classification: "qualifying" | "disqualifying";
  shares: number; ordinaryIncomeTotal: number; basisPerShare: number;
  capitalGainTotal: number; capitalIsLongTerm: boolean;
}

export function esppDisposition(
  shares: number,
  grantDate: string,
  grantFmv: number,
  purchaseDate: string,
  purchaseFmv: number,
  purchasePrice: number,
  saleDate: string,
  salePrice: number,
): EsppResult {
  const qualifying = daysBetween(grantDate, saleDate) > 730 && daysBetween(purchaseDate, saleDate) > 365;
  const actualGainPerShare = salePrice - purchasePrice;
  let ordinaryPerShare: number;
  let isLt: boolean;
  if (qualifying) {
    const grantDiscount = grantFmv - purchasePrice;
    ordinaryPerShare = actualGainPerShare < 0 ? 0 : Math.min(grantDiscount, actualGainPerShare);
    isLt = true;
  } else {
    ordinaryPerShare = purchaseFmv - purchasePrice;
    isLt = daysBetween(purchaseDate, saleDate) > 365;
  }
  const basisPerShare = purchasePrice + ordinaryPerShare;
  const capitalPerShare = salePrice - basisPerShare;
  return {
    classification: qualifying ? "qualifying" : "disqualifying",
    shares,
    ordinaryIncomeTotal: round2(ordinaryPerShare * shares),
    basisPerShare: round2(basisPerShare),
    capitalGainTotal: round2(capitalPerShare * shares),
    capitalIsLongTerm: isLt,
  };
}
