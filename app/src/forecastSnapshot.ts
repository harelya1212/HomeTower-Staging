// Forecast snapshots (ROUND 62, R62-6 / P1-7) - a forecast is a
// function of its inputs AND its versions, and until this round
// nothing recorded either. A snapshot persists:
//
//   asOfDate        - the day the forecast is computed for
//   engineVersion   - ENGINE_VERSION (engine/packs.ts)
//   dataVersion     - a fingerprint of the canonical inputs
//                     (documents, family, goals, asset rows), so
//                     two states with the same dataVersion are
//                     the same household for forecast purposes
//   taxPackVersion  - the federal + state content packs
//   ocrMapsVersion  - the field maps the documents were read with
//   assumptionVersion - the goal-assumption shape
//   inputFactIds    - the fingerprints of the source records the
//                     forecast actually consumed
//   result          - the headline outputs
//
// Same inputs + same versions -> the same result, byte for byte:
// the computation is a pure function of the state and the fixed
// asOfDate (no wall clock, no randomness), which the round-62
// suite pins under a fixed clock.
import { ENGINE_VERSION, federalPack, ocrMapsPack, statesPack } from "../engine/packs.ts";
import { computeHouseholdTax } from "../engine/snapshot.ts";
import { buildAssetRegistry } from "./assetRegistry.ts";
import { DEFAULT_EDU_ANNUAL_COST, educationOutlookFor } from "./goals.ts";
import { payslip401kTotals, payslipForecast } from "./payslips.ts";
import { fingerprintText, recordFingerprint } from "./reconcile.ts";
import { computeRetirementModel } from "./retirementModel.ts";
import type { HouseholdState } from "./store.tsx";

/** The goal-assumption shape version: the set of assumption
 * fields the forecasts read (return, inflation, spending tiers,
 * bridge and quick-estimate inputs). Bump when a field's MEANING
 * changes, not when a value does - values live in dataVersion. */
export const ASSUMPTION_VERSION = "1.0";

export interface ForecastSnapshotResult {
  retirementCurrent: number;
  retirementProjected: number;
  retirementNeed: number;
  readinessPct: number | null;
  ssAnnualTotal: number;
  pensionAnnual: number;
  spendingAnnual: number;
  spendingTier: string;
  hsaCurrent: number | null;
  k401ByOwner: { memberId: string; balance: number }[];
  education: { childId: string; balance: number; duration: number; annualCost: number; gap: number; status: string }[];
  federalRefundOwe: number | null;
  stateRefundOwe: number | null;
}

export interface ForecastSnapshot {
  asOfDate: string;
  engineVersion: string;
  dataVersion: string;
  taxPackVersion: string;
  ocrMapsVersion: string;
  assumptionVersion: string;
  inputFactIds: string[];
  result: ForecastSnapshotResult;
}

const FORECAST_DOC_TYPES = new Set(["payslip", "401k_statement", "hsa_statement", "529_statement", "pension_statement", "ssa_statement"]);

/** The canonical input fingerprint: the documents' own
 * fingerprints plus the family / goals / asset facts the
 * forecasts read, in a fixed order - order-independent over
 * document storage order, sensitive to every value. */
export function forecastDataVersion(state: HouseholdState): string {
  const docPart = state.intake.documents
    .map((d) => `${d.docType}|${recordFingerprint(d) ?? ""}|${d.quarantined ? "q" : ""}|${JSON.stringify(d.fields ?? {})}|${d.ownerMemberId ?? ""}`)
    .sort()
    .join(";");
  const famPart = state.family
    .map((m) => [m.id, m.role, m.dob, m.retireAge, m.ssAnnual, m.pensionAnnual, m.eduAnnualCost, m.eduCostSource ?? "", m.eduBalance, m.eduMonthly, m.studentNow ? 1 : 0, m.yearsLeftInCollege, m.eduDurationYears, m.eduScholarshipYear].join(","))
    .join(";");
  const goalPart = JSON.stringify(state.goals);
  const assetPart = state.assets.map((a) => [a.id, a.kind, a.ownerName, a.value, a.monthly].join(",")).join(";");
  return fingerprintText([docPart, famPart, goalPart, assetPart].join("||"));
}

/** Compute the snapshot for a state as of a FIXED date. The
 * derivations mirror HomeScreen exactly (payslip forecast ->
 * effective income, registry -> balances) so the snapshot is the
 * dashboard's own forecast, versioned - not a second model. */
export function forecastSnapshot(state: HouseholdState, asOfDate: string): ForecastSnapshot {
  const docs = state.intake.documents;
  const slipFc = payslipForecast(docs, state.family, state.jobs, asOfDate);
  const k401Totals = payslip401kTotals(docs, asOfDate, state.jobs);
  const registry = buildAssetRegistry(state);
  const g = state.goals;
  const retBalance = registry.retirementAccounts.length ? registry.retirementTotal : g.retirementBalance;
  const retMonthly = registry.retirementAccounts.length ? registry.retirementMonthly : g.retirementMonthly;
  const effIncome = slipFc ? slipFc.projectedTaxable : state.grossIncome;
  const model = computeRetirementModel({
    state, today: asOfDate, slipFc, k401Totals, retBalance, retMonthly, effIncome,
    moneyFmt: (n) => String(n),
  });
  const children = state.family.filter((m) => m.role === "child");
  const eduChildren = children.map((c) => {
    const acct = registry.byKey.get(`529:${c.id}`);
    return acct ? { ...c, eduBalance: acct.value } : c;
  });
  const edu = educationOutlookFor(eduChildren, asOfDate, g.assumedReturnPct, DEFAULT_EDU_ANNUAL_COST);
  let snap: ReturnType<typeof computeHouseholdTax> | null = null;
  try {
    snap = computeHouseholdTax(
      state.intake.filingStatus,
      effIncome,
      slipFc ? slipFc.projectedFederal : state.federalWithholdingYtd,
      slipFc ? slipFc.projectedState : state.stateWithholdingYtd,
      state.ltcgIncome, null, 0, 0, "AZ",
      slipFc ? slipFc.earners.map((e) => e.projectedMedicareWages) : null,
      slipFc ? slipFc.earners.map((e) => e.projectedMedicareWithheld) : null,
    );
  } catch { snap = null; }
  const inputFactIds = docs
    .filter((d) => FORECAST_DOC_TYPES.has(d.docType) && !d.quarantined)
    .map((d) => recordFingerprint(d) ?? `${d.docType}|${d.capturedOn ?? ""}`)
    .sort();
  return {
    asOfDate,
    engineVersion: ENGINE_VERSION,
    dataVersion: forecastDataVersion(state),
    taxPackVersion: `${String(federalPack().version ?? "")}+${String(statesPack().version ?? "")}`,
    ocrMapsVersion: String(ocrMapsPack().version ?? ""),
    assumptionVersion: ASSUMPTION_VERSION,
    inputFactIds,
    result: {
      retirementCurrent: Math.round(model.currentRetBalance * 100) / 100,
      retirementProjected: Math.round(model.projectedToday * 100) / 100,
      retirementNeed: Math.round(model.hhRet.needBase * 100) / 100,
      readinessPct: model.readinessPct,
      ssAnnualTotal: Math.round(model.ssAnnualTotal * 100) / 100,
      pensionAnnual: Math.round(model.pensionAnnualEff * 100) / 100,
      spendingAnnual: Math.round(model.spendingAnnual * 100) / 100,
      spendingTier: model.spendingTier,
      hsaCurrent: registry.hsa ? registry.hsa.value : null,
      k401ByOwner: registry.accounts
        .filter((a) => a.kind === "401k")
        .map((a) => ({ memberId: a.ownerMemberId ?? "", balance: a.value })),
      education: edu.map((e) => ({
        childId: e.child.id,
        balance: Math.round((e.child.eduBalance || 0) * 100) / 100,
        duration: e.duration,
        annualCost: Math.round((e.usingDefaultCost ? DEFAULT_EDU_ANNUAL_COST : (e.child.eduAnnualCost ?? 0)) * 100) / 100,
        gap: Math.round(e.funding.gap * 100) / 100,
        status: e.status,
      })),
      federalRefundOwe: snap ? Math.round(snap.federalRefundOwe * 100) / 100 : null,
      stateRefundOwe: snap ? Math.round(snap.stateRefundOwe * 100) / 100 : null,
    },
  };
}
