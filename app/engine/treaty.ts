// US-Israel income tax treaty - TS port of treaty.py. Provisions live in
// the treaty-us-il content pack; the saving-clause effect is always
// stated (see the Python module docstring).
import { treatyPack, type Pack } from "./packs.ts";

export interface WithholdingResult { incomeType: string; treatyCapRate: number; articleNote: string }

export function withholdingCap(
  incomeType: string,
  opts: { corporate10pct?: boolean; financialInstitution?: boolean; governmentBacked?: boolean; copyrightRoyalty?: boolean } = {},
  pack: Pack = treatyPack(),
): WithholdingResult {
  const caps = pack.withholding_caps;
  if (incomeType === "dividends") {
    if (opts.corporate10pct) return { incomeType, treatyCapRate: caps.dividends_direct_corporate_10pct, articleNote: "Direct dividend: recipient company owns >= 10% of voting power - cap 12.5%." };
    return { incomeType, treatyCapRate: caps.dividends_general, articleNote: "General dividend cap 25%." };
  }
  if (incomeType === "interest") {
    if (opts.governmentBacked) return { incomeType, treatyCapRate: caps.interest_government_backed, articleNote: "Government-guaranteed or government-derived interest - exempt in the source state." };
    if (opts.financialInstitution) return { incomeType, treatyCapRate: caps.interest_financial_institution, articleNote: "Interest on a loan from a bank, savings institution or insurance company - cap 10%." };
    return { incomeType, treatyCapRate: caps.interest_general, articleNote: "General interest cap 17.5%." };
  }
  if (incomeType === "royalties") {
    if (opts.copyrightRoyalty) return { incomeType, treatyCapRate: caps.royalties_copyright, articleNote: "Copyright and film royalties - cap 10%." };
    return { incomeType, treatyCapRate: caps.royalties_industrial, articleNote: "Industrial royalties - cap 15%." };
  }
  throw new Error(`No treaty withholding cap for income type: ${incomeType}`);
}

export interface TreatyPosition { topic: string; taxableIn: string; savingClauseOverrides: boolean; note: string }

export function treatyPosition(topic: string, usCitizen: boolean, pack: Pack = treatyPack()): TreatyPosition {
  const p = pack.positions[topic];
  if (!p) throw new Error(`Unknown treaty topic: ${topic}`);
  if (topic === "social_security_benefits") {
    return { topic, taxableIn: p.taxable_in, savingClauseOverrides: false, note: p.note };
  }
  if (usCitizen) {
    return { topic, taxableIn: p.taxable_in, savingClauseOverrides: true, note: p.note + " Saving clause (Art. 6(3)): the US may still tax its citizen; relief comes via the foreign tax credit." };
  }
  return { topic, taxableIn: p.taxable_in, savingClauseOverrides: false, note: p.note };
}
