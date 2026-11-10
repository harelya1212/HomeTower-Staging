// Runtime financial invariants (ROUND 62, R62-7 / P1-8) - the
// trust rules, evaluated over canonical state on demand and
// surfaced in the developer diagnostics. Each rule is a real
// check over independently recomputed structures (registry vs
// resolutions vs the model), not a restatement of the code that
// produced the figures:
//
// 1. An HSA balance cannot equal a known 401(k) balance from
//    another account.
// 2. A 529 beneficiary account cannot belong to two children.
// 3. Historical tax-form figures (5498-SA fair market value,
//    1099-SA distributions) never act as current account
//    balances - no registry entry is sourced from a tax form,
//    and no account resolution is won by one.
// 4. Household retirement assets reconcile to their component
//    accounts (registry total == the sum of its entries, and the
//    model's per-adult composition parts sum to its balances).
// 5. Education balances reconcile to child-owned 529 accounts
//    (registry total == an independent per-beneficiary regrouping
//    of the statement readings).
// 6. Unknown cannot silently become zero: a value presented as
//    confirmed zero must rest on evidence, and an adult whose
//    Social Security is unknown must appear in the retirement
//    model's missing list - never as a silent $0 in a complete
//    forecast.
// 7. A stale fact cannot override a newer confirmed fact: every
//    registry balance's as-of equals the freshest eligible
//    source for that account, and no quarantined or contaminated
//    record wins any resolution.
import { buildAssetRegistry } from "./assetRegistry.ts";
import { k401StatementFor, ssForMember } from "./goals.ts";
import { payslip401kTotals } from "./payslips.ts";
import {
  contaminatedHsaIndices, docAsOf, eduResolutionFor, eligibleDocs,
  fieldNum, hsaResolution, recordFingerprint,
} from "./reconcile.ts";
import { computeRetirementModel } from "./retirementModel.ts";
import { employerMatchFor, k401StatementMatchFor } from "./goals.ts";
import type { HouseholdState } from "./store.tsx";

export interface InvariantResult {
  rule: string;
  ok: boolean;
  detail: string;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function runInvariants(state: HouseholdState, today: string): InvariantResult[] {
  const docs = state.intake.documents;
  const eligible = eligibleDocs(docs);
  const registry = buildAssetRegistry(state);
  const out: InvariantResult[] = [];
  const add = (rule: string, ok: boolean, detail: string) => out.push({ rule, ok, detail });

  // 1 - HSA vs 401(k) balance identity.
  {
    const k401Balances = eligible
      .filter((d) => d.docType === "401k_statement")
      .map((d) => fieldNum(d.fields, "ending_balance"))
      .filter((v): v is number => v !== null && v > 0);
    const hit = registry.hsa !== null && k401Balances.some((k) => Math.abs(k - registry.hsa!.value) <= 1);
    add(
      "HSA balance differs from every known 401(k) balance",
      !hit,
      registry.hsa
        ? `HSA $${registry.hsa.value.toLocaleString("en-US")} vs 401(k) balances [${k401Balances.map((k) => `$${k.toLocaleString("en-US")}`).join(", ") || "none"}]`
        : "No HSA account in the registry.",
    );
  }

  // 2 - One 529 account, one child.
  {
    const byAccount = new Map<string, Set<string>>();
    for (const d of eligible) {
      if (d.docType !== "529_statement" || !d.ownerMemberId) continue;
      const acct = d.accountId ?? d.fields?.["account_id"] ?? null;
      if (!acct) continue;
      byAccount.set(acct, new Set([...(byAccount.get(acct) ?? []), d.ownerMemberId]));
    }
    const shared = [...byAccount.entries()].filter(([, owners]) => owners.size > 1);
    add(
      "A 529 account belongs to exactly one child",
      shared.length === 0,
      shared.length === 0
        ? `${byAccount.size} assigned 529 account(s), each with one beneficiary.`
        : `Account(s) assigned to two children: ${shared.map(([a]) => a).join(", ")}`,
    );
  }

  // 3 - Tax forms are history, never current balances.
  {
    const formRefs = new Set(
      docs.filter((d) => d.docType === "hsa_5498_sa" || d.docType === "hsa_1099_sa")
        .map((d) => recordFingerprint(d) ?? `${d.docType}|${docAsOf(d)}`),
    );
    const sourced = registry.accounts.filter((a) => a.docRefs.some((r) => formRefs.has(r)));
    const hsaSrc = hsaResolution(docs).fields.ending_balance.source;
    add(
      "Tax-form figures never act as current balances",
      sourced.length === 0 && (hsaSrc === null || hsaSrc.docType === "hsa_statement"),
      sourced.length === 0
        ? "No registry account is sourced from a 5498-SA or 1099-SA; the HSA resolution reads statements only."
        : `Registry account(s) sourced from a tax form: ${sourced.map((a) => a.key).join(", ")}`,
    );
  }

  // 4 - Retirement reconciliation.
  {
    const partsSum = round2(registry.retirementAccounts.reduce((s, a) => s + a.value, 0));
    const registryOk = Math.abs(partsSum - registry.retirementTotal) <= 0.01;
    let modelOk = true;
    let modelDetail = "model not computed";
    try {
      const k = payslip401kTotals(docs, today, state.jobs);
      const model = computeRetirementModel({
        state, today, slipFc: null, k401Totals: k,
        retBalance: registry.retirementAccounts.length ? registry.retirementTotal : state.goals.retirementBalance,
        retMonthly: registry.retirementAccounts.length ? registry.retirementMonthly : state.goals.retirementMonthly,
        effIncome: state.grossIncome, moneyFmt: (n) => String(n),
      });
      modelOk = model.adultOutlook.every((a) => {
        const c = a.startComposition;
        return Math.abs(c.knownOwnedNon401k + c.statementAmount + c.unmappedFallback - a.bal) <= 0.01;
      });
      modelDetail = `per-adult composition parts sum to balances: ${modelOk}`;
    } catch (e) {
      modelOk = false;
      modelDetail = `model failed: ${e instanceof Error ? e.message : String(e)}`;
    }
    add(
      "Retirement assets reconcile to component accounts",
      registryOk && modelOk,
      `registry total $${registry.retirementTotal.toLocaleString("en-US")} == sum of ${registry.retirementAccounts.length} account(s): ${registryOk}; ${modelDetail}`,
    );
  }

  // 5 - Education reconciliation: regroup the readings by
  // beneficiary independently of the per-child queries.
  {
    const groups = new Map<string, { value: number; asOf: string }>();
    for (const d of eligible) {
      if (d.docType !== "529_statement") continue;
      const v = fieldNum(d.fields, "ending_balance");
      if (v === null || v <= 0) continue;
      const beneficiary = d.ownerMemberId ?? `name:${(d.fields?.["beneficiary_name"] ?? "").trim().toLowerCase().split(/\s+/)[0] ?? ""}`;
      if (!beneficiary) continue;
      const asOf = docAsOf(d);
      const cur = groups.get(beneficiary);
      if (!cur || asOf > cur.asOf) groups.set(beneficiary, { value: v, asOf });
    }
    const regrouped = round2([...groups.values()].reduce((s, g) => s + g.value, 0));
    add(
      "Education balances reconcile to child-owned 529 accounts",
      Math.abs(regrouped - registry.educationTotal) <= 0.01,
      `registry $${registry.educationTotal.toLocaleString("en-US")} vs independently regrouped $${regrouped.toLocaleString("en-US")} across ${groups.size} beneficiar(ies)`,
    );
  }

  // 6 - Unknown is never a silent zero.
  {
    const problems: string[] = [];
    const adults = state.family.filter((m) => m.role === "self" || m.role === "spouse");
    const k = payslip401kTotals(docs, today, state.jobs);
    for (const m of adults) {
      const ss = ssForMember(m, docs);
      if (ss.source === "none" && (m.ssAnnual ?? 0) > 0) problems.push(`${m.name}: SS marked manual with no figure`);
      const slipEarner = k?.perEarner.find((e) => e.name.trim().toLowerCase() === m.name.trim().toLowerCase());
      const stmtMatch = k401StatementMatchFor(docs, m.id);
      const match = employerMatchFor({
        payslipMonthly: slipEarner?.matchMonthlyPace ?? null,
        statement: stmtMatch,
        relevantDocsExist: docs.some((d) => d.docType === "payslip" || d.docType === "401k_statement"),
      });
      // A zero presented with a CONFIRMED-family status must rest
      // on evidence: a payslip that printed the match line, or a
      // statement that reported one. (By construction the
      // resolver only reaches those statuses from such evidence -
      // this rule is the runtime tripwire if that ever changes.)
      const confirmedFamily = ["from_payslip", "from_statement", "user_confirmed", "confirmed"].includes(match.status);
      if (confirmedFamily && slipEarner?.matchMonthlyPace == null && !stmtMatch && match.status !== "user_confirmed")
        problems.push(`${m.name}: match status ${match.status} with no payslip or statement evidence behind it`);
    }
    // The retirement accuracy must NAME Social Security as
    // missing whenever any adult's SS is unknown - the Quick
    // Estimate can never present itself as if SS were a
    // confirmed $0.
    try {
      const model = computeRetirementModel({
        state, today, slipFc: null, k401Totals: k,
        retBalance: registry.retirementAccounts.length ? registry.retirementTotal : state.goals.retirementBalance,
        retMonthly: registry.retirementAccounts.length ? registry.retirementMonthly : state.goals.retirementMonthly,
        effIncome: state.grossIncome, moneyFmt: (n) => String(n),
      });
      const anySsUnknown = adults.some((m) => ssForMember(m, docs).source === "none");
      if (anySsUnknown && !model.accuracy.missing.some((x) => /social security/i.test(x)))
        problems.push("an adult's Social Security is unknown but the retirement accuracy does not list it as missing");
      if (model.spendingTier === "quick" && model.accuracy.level === "X++")
        problems.push("a planning-estimate spending tier claims the highest accuracy level");
    } catch { /* the model failure is rule 4's report */ }
    add(
      "Unknown never silently becomes zero",
      problems.length === 0,
      problems.length === 0
        ? "Confirmed zeros rest on evidence; unknown Social Security is named as missing, and a planning estimate never claims full accuracy."
        : problems.join("; "),
    );
  }

  // 7 - Freshness: no stale or ineligible record wins.
  {
    const problems: string[] = [];
    const bad = contaminatedHsaIndices(docs);
    docs.forEach((d, i) => {
      if (d.quarantined || bad.has(i)) {
        const wins = hsaResolution(docs).fields.ending_balance.source === d
          || registry.accounts.some((a) => a.docRefs.includes(recordFingerprint(d) ?? "\u0000"));
        if (wins) problems.push(`an ineligible ${d.docType} record wins a resolution`);
      }
    });
    const freshest = (list: typeof docs, field: string): string =>
      list.reduce((best, d) => {
        const v = fieldNum(d.fields, field);
        return v !== null && v > 0 && docAsOf(d) > best ? docAsOf(d) : best;
      }, "");
    if (registry.hsa) {
      const maxAsOf = freshest(eligible.filter((d) => d.docType === "hsa_statement"), "ending_balance");
      if ((registry.hsa.asOf ?? "") !== maxAsOf)
        problems.push(`HSA as-of ${registry.hsa.asOf} is not the freshest eligible source (${maxAsOf})`);
    }
    for (const child of state.family.filter((m) => m.role === "child")) {
      const acct = registry.byKey.get(`529:${child.id}`);
      if (!acct) continue;
      const res = eduResolutionFor(docs, child.id).fields.ending_balance;
      if (res.asOf !== null && acct.asOf !== res.asOf)
        problems.push(`${child.name}: registry 529 as-of ${acct.asOf} != resolution as-of ${res.asOf}`);
    }
    for (const m of state.family.filter((x) => x.role === "self" || x.role === "spouse")) {
      const stmt = k401StatementFor(docs, m.id);
      const acct = registry.byKey.get(`401k:${m.id}`);
      if (stmt && acct && Math.abs(stmt.balance - acct.value) > 0.01)
        problems.push(`${m.name}: registry 401(k) $${acct.value} != statement resolution $${stmt.balance}`);
    }
    add(
      "A stale fact never overrides a newer confirmed fact",
      problems.length === 0,
      problems.length === 0
        ? "Every registry balance is its freshest eligible source; quarantined and contaminated records win nothing."
        : problems.join("; "),
    );
  }

  return out;
}

export function invariantViolations(results: InvariantResult[]): number {
  return results.filter((r) => !r.ok).length;
}
