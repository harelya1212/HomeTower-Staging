// Foreign accounts and income - TS port of foreign.py (FBAR, Form 8938,
// foreign tax credit limitation, single basket).
import { round2 } from "./packs.ts";

export const FBAR_THRESHOLD = 10_000;

const THRESHOLDS_8938: Record<string, [number, number]> = {
  "false|single": [50_000, 75_000],
  "false|head_of_household": [50_000, 75_000],
  "false|married_filing_jointly": [100_000, 150_000],
  "false|married_filing_separately": [50_000, 75_000],
  "true|single": [200_000, 300_000],
  "true|head_of_household": [200_000, 300_000],
  "true|married_filing_jointly": [400_000, 600_000],
  "true|married_filing_separately": [200_000, 300_000],
};

export interface FilingTest { required: boolean; reason: string }

export function fbarRequired(maxBalancesByAccount: number[]): FilingTest {
  const aggregate = maxBalancesByAccount.reduce((a, b) => a + b, 0);
  if (aggregate > FBAR_THRESHOLD) {
    return { required: true, reason: `Aggregate maximum foreign account balance $${aggregate.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} exceeds $10,000 - FBAR (FinCEN 114) filing required.` };
  }
  return { required: false, reason: `Aggregate maximum foreign account balance $${aggregate.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} does not exceed $10,000 - no FBAR filing required.` };
}

export function form8938Required(totalLastDay: number, totalMaxAnyTime: number, filingStatus: string, livingAbroad = false): FilingTest {
  const t = THRESHOLDS_8938[`${livingAbroad}|${filingStatus}`];
  if (!t) throw new Error(`Unknown filing status: ${filingStatus}`);
  const [lastDayT, anyTimeT] = t;
  if (totalLastDay > lastDayT || totalMaxAnyTime > anyTimeT) {
    return { required: true, reason: `Specified foreign financial assets exceed the 8938 threshold ($${lastDayT.toLocaleString("en-US")} last day / $${anyTimeT.toLocaleString("en-US")} any time) - Form 8938 required.` };
  }
  return { required: false, reason: `Specified foreign financial assets are within the 8938 thresholds ($${lastDayT.toLocaleString("en-US")} last day / $${anyTimeT.toLocaleString("en-US")} any time) - Form 8938 not required.` };
}

export interface FtcResult {
  foreignTaxesPaid: number; limitation: number; creditAllowed: number; excessCredit: number;
}

export function foreignTaxCredit(foreignTaxesPaid: number, foreignSourceTaxableIncome: number, totalTaxableIncome: number, usTaxBeforeCredits: number): FtcResult {
  const limitation = totalTaxableIncome <= 0 ? 0 : usTaxBeforeCredits * (foreignSourceTaxableIncome / totalTaxableIncome);
  const credit = Math.min(foreignTaxesPaid, Math.max(0, limitation));
  return {
    foreignTaxesPaid: round2(foreignTaxesPaid),
    limitation: round2(limitation),
    creditAllowed: round2(credit),
    excessCredit: round2(foreignTaxesPaid - credit),
  };
}
