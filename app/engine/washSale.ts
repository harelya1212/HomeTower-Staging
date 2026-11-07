// Wash sale detection - TS port of wash_sale.py. Limits kept explicit:
// exact ticker match only; disallowance in full against the first matching
// replacement lot, not proportionally per replaced share.
import { addDays, daysBetween, round4 } from "./packs.ts";

export interface TaxLot {
  ticker: string;
  broker: string;
  quantity: number;
  purchaseDate: string; // ISO date
  costBasisPerShare: number;
}

export interface WashSaleResult {
  triggered: boolean;
  disallowedLoss: number;
  adjustedBasisPerShare: number;
  replacementLotTicker: string;
  replacementLotBroker: string;
  replacementLotDate: string;
  explanation: string;
}

export const WINDOW_DAYS = 30;

export function checkWashSale(
  saleTicker: string,
  saleDate: string,
  lossPerShare: number,
  quantitySold: number,
  existingLots: TaxLot[],
): WashSaleResult {
  const noWash: WashSaleResult = {
    triggered: false, disallowedLoss: 0, adjustedBasisPerShare: 0,
    replacementLotTicker: saleTicker, replacementLotBroker: "", replacementLotDate: saleDate,
    explanation: "No wash sale triggered.",
  };
  if (lossPerShare >= 0) return noWash;
  const windowStart = addDays(saleDate, -WINDOW_DAYS);
  const windowEnd = addDays(saleDate, WINDOW_DAYS);
  let replacement: TaxLot | undefined;
  for (const lot of existingLots) {
    if (lot.ticker.toUpperCase() !== saleTicker.toUpperCase()) continue;
    if (lot.purchaseDate === saleDate) continue;
    if (windowStart <= lot.purchaseDate && lot.purchaseDate <= windowEnd) { replacement = lot; break; }
  }
  if (!replacement) return noWash;
  const disallowed = Math.abs(lossPerShare * quantitySold);
  const adjustedBasis = replacement.costBasisPerShare + disallowed / replacement.quantity;
  return {
    triggered: true,
    disallowedLoss: disallowed,
    adjustedBasisPerShare: round4(adjustedBasis),
    replacementLotTicker: replacement.ticker,
    replacementLotBroker: replacement.broker,
    replacementLotDate: replacement.purchaseDate,
    explanation: `Wash sale triggered: loss of $${disallowed.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} is disallowed. Your replacement lot (${replacement.ticker} @ ${replacement.broker}, purchased ${replacement.purchaseDate}) basis is adjusted to $${adjustedBasis.toFixed(4)}/share.`,
  };
}
