// TaxImpact - TS port of taximpact.py (with the audit fixes carried over:
// magi_with_gain defined; plain bracket comparison).
import { computeLtcgTax, computeNiit, computeOrdinaryTax, distanceToNextBracket, marginalRate } from "./federal.ts";
import { daysBetween, federalPack, round2, round4, type Pack } from "./packs.ts";
import { computeStateTaxOnGain } from "./state.ts";
import { checkWashSale, type TaxLot, type WashSaleResult } from "./washSale.ts";

export const LTCG_HOLDING_DAYS = 365;

export interface SaleInput {
  ticker: string;
  broker: string;
  quantity: number;
  costBasisPerShare: number;
  salePricePerShare: number;
  purchaseDate: string;
  saleDate: string;
  lotSelection?: string;
  acquisitionType?: string;
}

export interface SimulationContext {
  filingStatus: string;
  taxYear: number;
  state: string;
  estimatedOrdinaryIncome: number;
  federalWithholdingYtd?: number;
  stateWithholdingYtd?: number;
  realizedStGainsYtd?: number;
  realizedLtGainsYtd?: number;
  capitalLossCarryforward?: number;
  magi?: number | null;
  netInvestmentIncomeYtd?: number;
  existingLots?: TaxLot[];
}

export interface TaxImpact {
  gainAmount: number; isLongTerm: boolean; daysHeld: number;
  federalTax: number; niit: number; stateTax: number; totalTaxImpact: number;
  effectiveTaxRate: number; netProceeds: number; netProfit: number;
  afterTaxReturnPct: number; marginalBracket: number; entersHigherBracket: boolean;
  distanceToNextBracket: number; nextBracketRate: number; lossesApplied: number;
  washSale: WashSaleResult;
}

export interface TimingComparison {
  taxIfSoldNowSt: number; taxIfSoldLaterLt: number; taxSavingsByWaiting: number;
  daysUntilLongTerm: number; breakEvenExplanation: string;
}

export interface SimulationResult {
  grossProceeds: number; rawGain: number; adjustedGain: number;
  impact: TaxImpact; timing: TimingComparison | null; bracketAlert: string; summary: string;
}

function federalTaxOnGain(gain: number, isLongTerm: boolean, ordinaryIncome: number, status: string, pack: Pack): number {
  const stdDeduction = pack.standard_deduction[status] ?? 32200;
  const taxableOrdinary = Math.max(0, ordinaryIncome - stdDeduction);
  if (isLongTerm) return computeLtcgTax(Math.max(0, gain), taxableOrdinary, status, pack);
  const taxWithout = computeOrdinaryTax(taxableOrdinary, status, pack);
  const taxWith = computeOrdinaryTax(taxableOrdinary + Math.max(0, gain), status, pack);
  return Math.max(0, taxWith - taxWithout);
}

export function simulate(sale: SaleInput, ctx: SimulationContext, pack: Pack = federalPack()): SimulationResult {
  const daysHeld = daysBetween(sale.purchaseDate, sale.saleDate);
  const isLongTerm = daysHeld > LTCG_HOLDING_DAYS;
  const grossProceeds = sale.salePricePerShare * sale.quantity;
  const rawGain = (sale.salePricePerShare - sale.costBasisPerShare) * sale.quantity;
  const wash = checkWashSale(sale.ticker, sale.saleDate, sale.salePricePerShare - sale.costBasisPerShare, sale.quantity, ctx.existingLots ?? []);

  let effectiveGain = rawGain;
  if (wash.triggered) effectiveGain = 0;
  let lossesApplied = 0;
  let adjustedGain = effectiveGain;
  const carryforward = ctx.capitalLossCarryforward ?? 0;
  if (effectiveGain > 0 && carryforward > 0) {
    lossesApplied = Math.min(effectiveGain, carryforward);
    adjustedGain = effectiveGain - lossesApplied;
  }

  const baseMagi = ctx.magi ?? ctx.estimatedOrdinaryIncome;
  const magiWithGain = baseMagi + Math.max(0, adjustedGain);
  const netInv = (ctx.netInvestmentIncomeYtd ?? 0) + Math.max(0, adjustedGain);

  const federalTax = federalTaxOnGain(adjustedGain, isLongTerm, ctx.estimatedOrdinaryIncome, ctx.filingStatus, pack);
  const niit = adjustedGain > 0 ? computeNiit(magiWithGain, netInv, ctx.filingStatus, pack) : 0;
  const stateTax = computeStateTaxOnGain(Math.max(0, adjustedGain), ctx.state, isLongTerm, ctx.estimatedOrdinaryIncome).tax;
  const totalTax = federalTax + niit + stateTax;
  const effectiveRate = adjustedGain > 0 ? totalTax / adjustedGain : 0;
  const netProceeds = grossProceeds - totalTax;
  const netProfit = adjustedGain - totalTax;
  const afterTaxReturn = sale.costBasisPerShare > 0 ? netProfit / (sale.costBasisPerShare * sale.quantity) : 0;

  const stdDed = pack.standard_deduction[ctx.filingStatus] ?? 32200;
  const taxableOrdinary = Math.max(0, ctx.estimatedOrdinaryIncome - stdDed);
  const mRate = marginalRate(taxableOrdinary, ctx.filingStatus, pack);
  const [dist, nextRate] = distanceToNextBracket(taxableOrdinary, ctx.filingStatus, pack);
  const entersHigher = adjustedGain > dist && !isLongTerm;

  let timing: TimingComparison | null = null;
  const daysUntilLt = LTCG_HOLDING_DAYS - daysHeld;
  if (!isLongTerm && adjustedGain > 0) {
    const taxSt = federalTax + niit + stateTax;
    const ltFederal = federalTaxOnGain(adjustedGain, true, ctx.estimatedOrdinaryIncome, ctx.filingStatus, pack);
    const ltNiit = computeNiit(magiWithGain, netInv, ctx.filingStatus, pack);
    const ltState = computeStateTaxOnGain(adjustedGain, ctx.state, true, ctx.estimatedOrdinaryIncome).tax;
    const taxLt = ltFederal + ltNiit + ltState;
    const savings = taxSt - taxLt;
    timing = {
      taxIfSoldNowSt: round2(taxSt),
      taxIfSoldLaterLt: round2(taxLt),
      taxSavingsByWaiting: round2(savings),
      daysUntilLongTerm: Math.max(0, daysUntilLt),
      breakEvenExplanation: savings > 0
        ? `Waiting ${Math.max(0, daysUntilLt)} more days saves $${savings.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} in taxes by converting to long-term capital gains.`
        : "Holding longer provides no additional tax benefit.",
    };
  }

  const bracketAlert = wash.triggered ? "RED" : entersHigher || effectiveRate * 100 > 25 ? "YELLOW" : "GREEN";
  let summary = `${isLongTerm ? "LT" : "ST"} gain of $${adjustedGain.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} on ${sale.ticker}. Total tax impact: $${totalTax.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${(effectiveRate * 100).toFixed(1)}% effective). Net proceeds: $${netProceeds.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`;
  if (wash.triggered) summary = `WASH SALE ALERT - ${wash.explanation} ` + summary;

  return {
    grossProceeds: round2(grossProceeds),
    rawGain: round2(rawGain),
    adjustedGain: round2(adjustedGain),
    impact: {
      gainAmount: round2(adjustedGain), isLongTerm, daysHeld,
      federalTax: round2(federalTax), niit: round2(niit), stateTax: round2(stateTax),
      totalTaxImpact: round2(totalTax), effectiveTaxRate: round4(effectiveRate),
      netProceeds: round2(netProceeds), netProfit: round2(netProfit),
      afterTaxReturnPct: round2(afterTaxReturn * 100), marginalBracket: Math.round(mRate * 1000) / 10,
      entersHigherBracket: entersHigher, distanceToNextBracket: round2(dist),
      nextBracketRate: Math.round(nextRate * 1000) / 10, lossesApplied: round2(lossesApplied), washSale: wash,
    },
    timing,
    bracketAlert,
    summary,
  };
}
