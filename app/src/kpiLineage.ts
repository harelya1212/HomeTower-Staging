// KPI lineage (ROUND 62, R62-5) - the developer-only "Why this
// number?" trace. Round 60's provenance work reported honestly
// what did NOT exist: no fact IDs, no per-record document IDs, no
// model-version constant, no recompute timestamps. This module
// closes that: every material Home KPI traces through
//
//   displayed KPI -> engine output -> canonical facts ->
//   account snapshots (the Asset Registry) -> source document(s)
//
// A fact is identified by its source record's fingerprint (the
// round-58 content fingerprint - a stable per-reading ID), the
// field name, its value and its as-of date. A KPI whose trace
// cannot name at least one canonical fact or account is reported
// with coverage "none" - the diagnostics surface counts coverage
// and the round-62 suite pins it at 100% for the material set.
import type { DocumentRecord } from "../engine/intake.ts";
import { computeHouseholdTax } from "../engine/snapshot.ts";
import { buildAssetRegistry, type AssetRegistry, type RegistryAccount } from "./assetRegistry.ts";
import { DEFAULT_EDU_ANNUAL_COST, educationOutlookFor } from "./goals.ts";
import { payslip401kTotals, payslipForecast } from "./payslips.ts";
import { docAsOf, fieldNum, recordFingerprint, sourceLabelFor } from "./reconcile.ts";
import { computeRetirementModel } from "./retirementModel.ts";
import type { HouseholdState } from "./store.tsx";

export interface KpiFact {
  field: string;
  value: number | string | null;
  asOf: string | null;
  docType: string;
  /** The source record's fingerprint - the fact's document ID. */
  docRef: string;
  capturedOn: string | null;
}

export interface KpiTrace {
  kpi: string;
  displayed: string;
  engineOutput: Record<string, number | string | null>;
  facts: KpiFact[];
  /** Registry account keys this KPI reads. */
  accounts: string[];
  /** Human-readable source descriptors. */
  sources: string[];
  coverage: "full" | "none";
}

const money2 = (n: number): string => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money0 = (n: number): string => `$${Math.round(n).toLocaleString("en-US")}`;
const refOf = (d: DocumentRecord): string => recordFingerprint(d) ?? `${d.docType}|${docAsOf(d)}`;

function fact(d: DocumentRecord, field: string): KpiFact {
  return {
    field,
    value: fieldNum(d.fields, field) ?? d.fields?.[field] ?? null,
    asOf: docAsOf(d) || null,
    docType: d.docType,
    docRef: refOf(d),
    capturedOn: d.capturedOn ?? null,
  };
}

function describe(d: DocumentRecord): string {
  return `${d.docType} (${sourceLabelFor(d)})`;
}

function accountFacts(registry: AssetRegistry, docs: DocumentRecord[], acct: RegistryAccount): KpiFact[] {
  const out: KpiFact[] = [];
  for (const ref of acct.docRefs) {
    const d = docs.find((x) => refOf(x) === ref);
    if (d) out.push(fact(d, "ending_balance"));
  }
  return out;
}

export function kpiLineage(state: HouseholdState, today: string): KpiTrace[] {
  const docs = state.intake.documents;
  const registry = buildAssetRegistry(state);
  const g = state.goals;
  const slipFc = payslipForecast(docs, state.family, state.jobs, today);
  const k401Totals = payslip401kTotals(docs, today, state.jobs);
  const retBalance = registry.retirementAccounts.length ? registry.retirementTotal : g.retirementBalance;
  const retMonthly = registry.retirementAccounts.length ? registry.retirementMonthly : g.retirementMonthly;
  const effIncome = slipFc ? slipFc.projectedTaxable : state.grossIncome;
  const model = computeRetirementModel({ state, today, slipFc, k401Totals, retBalance, retMonthly, effIncome, moneyFmt: money0 });
  const traces: KpiTrace[] = [];
  const push = (t: Omit<KpiTrace, "coverage">) =>
    traces.push({ ...t, coverage: t.facts.length > 0 || t.accounts.length > 0 ? "full" : "none" });

  // HSA current balance.
  if (registry.hsa) {
    const acct = registry.hsa;
    push({
      kpi: "HSA current balance",
      displayed: money2(acct.value),
      engineOutput: { registryValue: acct.value, source: acct.source },
      facts: accountFacts(registry, docs, acct),
      accounts: [acct.key],
      sources: acct.docRefs.map((r) => docs.find((d) => refOf(d) === r)).filter(Boolean).map((d) => describe(d!)),
    });
  }

  // 401(k) per owner + the household retirement current balance.
  for (const acct of registry.accounts.filter((a) => a.kind === "401k")) {
    push({
      kpi: `401(k) balance - ${acct.ownerName || "owner"}`,
      displayed: money2(acct.value),
      engineOutput: { registryValue: acct.value, source: acct.source },
      facts: accountFacts(registry, docs, acct),
      accounts: [acct.key],
      sources: acct.docRefs.map((r) => docs.find((d) => refOf(d) === r)).filter(Boolean).map((d) => describe(d!)),
    });
  }
  push({
    kpi: "Retirement - current balance (household)",
    displayed: money0(model.currentRetBalance),
    engineOutput: {
      currentRetBalance: Math.round(model.currentRetBalance * 100) / 100,
      perAdult: model.adultOutlook.map((a) => `${a.m.name}: ${Math.round(a.bal * 100) / 100}`).join("; ") || null,
    },
    facts: registry.retirementAccounts.flatMap((a) => accountFacts(registry, docs, a)),
    accounts: registry.retirementAccounts.map((a) => a.key),
    sources: [...new Set(registry.retirementAccounts.flatMap((a) => a.docRefs))]
      .map((r) => docs.find((d) => refOf(d) === r)).filter(Boolean).map((d) => describe(d!)),
  });
  push({
    kpi: "Retirement - projected portfolio and need",
    displayed: `${money0(model.projectedToday)} projected / ${money0(model.hhRet.needBase)} needed`,
    engineOutput: {
      projectedToday: Math.round(model.projectedToday * 100) / 100,
      needBase: Math.round(model.hhRet.needBase * 100) / 100,
      spendingAnnual: Math.round(model.spendingAnnual * 100) / 100,
      spendingTier: model.spendingTier,
      ssAnnualTotal: Math.round(model.ssAnnualTotal * 100) / 100,
      pensionAnnual: Math.round(model.pensionAnnualEff * 100) / 100,
    },
    facts: [
      ...registry.retirementAccounts.flatMap((a) => accountFacts(registry, docs, a)),
      ...docs.filter((d) => d.docType === "payslip").slice(0, 4).map((d) => fact(d, "ytd_gross")),
    ],
    accounts: registry.retirementAccounts.map((a) => a.key),
    sources: [...new Set(registry.retirementAccounts.flatMap((a) => a.docRefs))]
      .map((r) => docs.find((d) => refOf(d) === r)).filter(Boolean).map((d) => describe(d!)),
  });

  // Education per child.
  const children = state.family.filter((m) => m.role === "child");
  const eduChildren = children.map((c) => {
    const acct = registry.byKey.get(`529:${c.id}`);
    return acct ? { ...c, eduBalance: acct.value } : c;
  });
  const edu = educationOutlookFor(eduChildren, today, g.assumedReturnPct, DEFAULT_EDU_ANNUAL_COST);
  for (const e of edu) {
    const acct = registry.byKey.get(`529:${e.child.id}`);
    push({
      kpi: `Education outlook - ${e.child.name || "child"}`,
      displayed: e.funding.gap > 0 ? `${money0(e.funding.gap)} gap` : "covered",
      engineOutput: {
        gap: Math.round(e.funding.gap * 100) / 100,
        duration: e.duration,
        annualCost: e.usingDefaultCost ? DEFAULT_EDU_ANNUAL_COST : (e.child.eduAnnualCost ?? 0),
        usingDefaultCost: e.usingDefaultCost ? 1 : 0,
        status: e.status,
      },
      facts: acct ? accountFacts(registry, docs, acct) : [],
      accounts: acct ? [acct.key] : [],
      sources: acct ? acct.docRefs.map((r) => docs.find((d) => refOf(d) === r)).filter(Boolean).map((d) => describe(d!)) : [],
    });
  }

  // Tax forecast.
  let snap: ReturnType<typeof computeHouseholdTax> | null = null;
  try {
    snap = computeHouseholdTax(
      state.intake.filingStatus, effIncome,
      slipFc ? slipFc.projectedFederal : state.federalWithholdingYtd,
      slipFc ? slipFc.projectedState : state.stateWithholdingYtd,
      state.ltcgIncome, null, 0, 0, "AZ",
      slipFc ? slipFc.earners.map((e) => e.projectedMedicareWages) : null,
      slipFc ? slipFc.earners.map((e) => e.projectedMedicareWithheld) : null,
    );
  } catch { snap = null; }
  if (snap) {
    const slipFacts = docs.filter((d) => d.docType === "payslip").slice(0, 4)
      .flatMap((d) => [fact(d, "ytd_taxable_wages"), fact(d, "ytd_federal_withheld")]);
    push({
      kpi: "Tax forecast - federal refund / owed",
      displayed: money0(snap.federalRefundOwe),
      engineOutput: { federalRefundOwe: Math.round(snap.federalRefundOwe * 100) / 100, federalTax: Math.round(snap.federalTax * 100) / 100, effIncome: Math.round(effIncome * 100) / 100 },
      facts: slipFacts,
      accounts: [],
      sources: [...new Set(docs.filter((d) => d.docType === "payslip").map((d) => describe(d)))],
    });
    push({
      kpi: "Tax forecast - state refund / owed",
      displayed: money0(snap.stateRefundOwe),
      engineOutput: { stateRefundOwe: Math.round(snap.stateRefundOwe * 100) / 100, stateTax: Math.round(snap.stateTax * 100) / 100 },
      facts: slipFacts,
      accounts: [],
      sources: [...new Set(docs.filter((d) => d.docType === "payslip").map((d) => describe(d)))],
    });
  }

  return traces;
}

/** Lineage coverage over the material KPI set: the share of
 * traces that name at least one canonical fact or account. */
export function lineageCoverage(traces: KpiTrace[]): number {
  if (traces.length === 0) return 1;
  return traces.filter((t) => t.coverage === "full").length / traces.length;
}
