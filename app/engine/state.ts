// State tax on a capital gain - TS port of state.py. Scope limit kept:
// progressive states use a single effective rate at ~$250K income and
// results carry that approximation note.
import { round2, statesPack, type Pack } from "./packs.ts";

export interface StateTaxResult {
  state: string;
  tax: number;
  rateApplied: number;
  note: string;
}

export function computeStateTaxOnGain(
  gain: number,
  stateIn: string,
  isLongTerm = true,
  ordinaryIncome = 0,
  pack: Pack = statesPack(),
): StateTaxResult {
  const state = stateIn.toUpperCase();
  if (gain <= 0) return { state, tax: 0, rateApplied: 0, note: "No taxable gain." };
  if (pack.no_income_tax_states.includes(state)) {
    return { state, tax: 0, rateApplied: 0, note: `${state} has no state income tax.` };
  }
  const special = pack.special ?? {};
  if (state === "WA") {
    const wa = special.WA;
    if (isLongTerm && gain > wa.ltcg_threshold) {
      return { state, tax: round2((gain - wa.ltcg_threshold) * wa.ltcg_rate), rateApplied: wa.ltcg_rate, note: `WA 7% capital gains tax on gains above $${wa.ltcg_threshold.toLocaleString("en-US")}.` };
    }
    return { state, tax: 0, rateApplied: 0, note: "WA capital gains tax only applies to LT gains above threshold." };
  }
  if (state === "MA") {
    const ma = special.MA;
    const rate = isLongTerm ? ma.lt_rate : ma.st_rate;
    return { state, tax: round2(gain * rate), rateApplied: rate, note: `MA ${isLongTerm ? "5% long-term" : "8.5% short-term"} capital gains rate.` };
  }
  if (state in pack.flat_rates) {
    const rate = pack.flat_rates[state];
    return { state, tax: round2(gain * rate), rateApplied: rate, note: `${state} flat income tax rate ${(rate * 100).toFixed(2)}%.` };
  }
  if (state in pack.progressive_effective_rates) {
    const rate = pack.progressive_effective_rates[state];
    return { state, tax: round2(gain * rate), rateApplied: rate, note: `${state} effective rate ~${(rate * 100).toFixed(2)}% at this income level. Note: approximate - full bracket table recommended for production.` };
  }
  return { state, tax: 0, rateApplied: 0, note: `State '${state}' not yet in database. Tax defaulted to $0 - verify manually.` };
}

export function computeArizonaTax(arizonaAgi: number, pack: Pack = statesPack()): number {
  return Math.max(0, arizonaAgi * pack.flat_rates.AZ);
}

/** ROUND 60 (P1-A) - what the Arizona model IS, stated by the
 * engine itself so every surface labels it the same way: Arizona
 * AGI x the 2.5% flat rate, with NO Form 140 logic - no standard
 * deduction, no additions or subtractions, no dependent, school
 * or charitable credits, no prior-year adjustments. It is a
 * planning estimate, and the state domain's accuracy is capped
 * (domainAccuracy.ts) until a full Form 140 model exists. */
export interface StateTaxModelInfo {
  state: string;
  modelKind: "flat_rate_approximation" | "full_return";
  fullReturnModeled: boolean;
  /** The four label parts, in display order. */
  labelParts: string[];
  label: string;
}

export function stateTaxModelInfo(stateIn: string): StateTaxModelInfo {
  const state = stateIn.toUpperCase();
  if (state === "AZ") {
    const labelParts = ["Arizona projection", "Planning estimate", "Flat-rate approximation", "Full Arizona return adjustments not yet modeled"];
    return { state, modelKind: "flat_rate_approximation", fullReturnModeled: false, labelParts, label: labelParts.join(" - ") };
  }
  return { state, modelKind: "full_return", fullReturnModeled: true, labelParts: [], label: "" };
}
