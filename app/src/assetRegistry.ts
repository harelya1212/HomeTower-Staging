// The Asset Registry (ROUND 62, R62-4) - the single source of
// truth for account balances.
//
// Before this round, consumers derived balances ad hoc: the Home
// rings read the user-edited assets table (on the owner's device:
// one row, {kind: "home", value: 0} - so every document-proven
// balance was invisible to them and a stale goal aggregate stood
// in), the retirement model filtered the same table by name, and
// the Documents cards ran their own document scans. The registry
// replaces all of that with ONE deterministic derivation from
// documents + user entries:
//
// - a 401(k) per adult, from their owned statement
//   (k401StatementFor - statements say what the household HAS);
// - the household HSA, from the defended resolution
//   (hsaBalanceSnapshots over eligibleDocs - quarantined and
//   contaminated records never enter);
// - a 529 per child, from that child's resolution;
// - a brokerage account per account number, freshest statement;
// - employer stock, home and everything else from user entries.
//
// A document-derived entry REPLACES a user row for the same
// account (the statement is the balance of record; the row keeps
// only its monthly figure and its label). Every entry carries
// its provenance: source, as-of and the source records'
// fingerprints, which is what the KPI lineage (R62-5) and the
// runtime invariants (R62-7) read. Balances are numbers from a
// named source - an account with no source does not get an
// entry, never a silent zero (R62-3).
import type { DocumentRecord } from "../engine/intake.ts";
import { k401StatementFor } from "./goals.ts";
import {
  docAsOf, eligibleDocs, eduResolutionFor, fieldNum, hsaBalanceSnapshots,
  recordFingerprint, resolveFields,
} from "./reconcile.ts";
import type { AssetKind, HouseholdState, UiMember } from "./store.tsx";

export type RegistryKind = AssetKind | "employer_stock";
export type RegistrySource = "document" | "user" | "document+user";

export interface RegistryAccount {
  key: string;
  kind: RegistryKind;
  label: string;
  ownerMemberId: string | null;
  ownerName: string;
  /** The balance from the entry's source of record. */
  value: number;
  /** The user-entered monthly figure for the account (0 when the
   * user never entered one; document entries carry 0 - pace comes
   * from payroll, a separate evidence stream). */
  monthly: number;
  source: RegistrySource;
  asOf: string | null;
  accountId: string | null;
  /** Fingerprints of the source records (document entries), so a
   * displayed figure can be traced to the exact reading. */
  docRefs: string[];
  userAssetId: string | null;
}

export interface AssetRegistry {
  accounts: RegistryAccount[];
  byKey: Map<string, RegistryAccount>;
  /** 401(k) + IRA balances and monthly figures (the Home ring and
   * the model fallback inputs derive from these). */
  retirementAccounts: RegistryAccount[];
  retirementTotal: number;
  retirementMonthly: number;
  educationAccounts: RegistryAccount[];
  educationTotal: number;
  educationMonthly: number;
  hsa: RegistryAccount | null;
}

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");
const firstName = (s: string): string => (s || "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
const refOf = (d: DocumentRecord): string => recordFingerprint(d) ?? `${d.docType}|${docAsOf(d)}`;
const round2 = (n: number): number => Math.round(n * 100) / 100;

function docEntry(partial: Omit<RegistryAccount, "monthly" | "source" | "userAssetId">): RegistryAccount {
  return { ...partial, monthly: 0, source: "document", userAssetId: null };
}

export function buildAssetRegistry(state: HouseholdState): AssetRegistry {
  const docs = eligibleDocs(state.intake.documents);
  const family = state.family;
  const adults = family.filter((m) => m.role === "self" || m.role === "spouse");
  const children = family.filter((m) => m.role === "child");
  const accounts: RegistryAccount[] = [];

  // 401(k) per adult - the owned statement's ending balance.
  for (const m of adults) {
    const stmt = k401StatementFor(docs, m.id);
    if (!stmt || !(stmt.balance > 0)) continue;
    const src = docs.find((d) => d.docType === "401k_statement" && d.ownerMemberId === m.id
      && fieldNum(d.fields, "ending_balance") === stmt.balance && (d.capturedOn ?? null) === stmt.capturedOn)
      ?? docs.find((d) => d.docType === "401k_statement" && d.ownerMemberId === m.id && fieldNum(d.fields, "ending_balance") === stmt.balance);
    accounts.push(docEntry({
      key: `401k:${m.id}`,
      kind: "401k",
      label: `${m.name.split(" ")[0] || m.name} 401(k)`,
      ownerMemberId: m.id,
      ownerName: m.name,
      value: stmt.balance,
      asOf: src ? docAsOf(src) : stmt.capturedOn,
      accountId: src?.accountId ?? null,
      docRefs: src ? [refOf(src)] : [],
    }));
  }

  // The household HSA - the defended current snapshot.
  const hsaSnap = hsaBalanceSnapshots(docs);
  if (hsaSnap.current.value !== null && hsaSnap.current.value > 0 && hsaSnap.current.source) {
    const src = hsaSnap.current.source;
    const owner = src.ownerMemberId ? family.find((m) => m.id === src.ownerMemberId) ?? null : null;
    accounts.push(docEntry({
      key: "hsa:household",
      kind: "hsa",
      label: "Health savings account",
      ownerMemberId: src.ownerMemberId ?? null,
      ownerName: owner?.name ?? "",
      value: hsaSnap.current.value,
      asOf: hsaSnap.current.asOf,
      accountId: src.accountId ?? null,
      docRefs: [refOf(src)],
    }));
  }

  // A 529 per child - the child's own resolution, with the
  // beneficiary-name fallback eduMonthlyTotal has always used
  // for unassigned readings.
  for (const c of children) {
    let bal = eduResolutionFor(docs, c.id).fields.ending_balance;
    if (bal.value === null && firstName(c.name)) {
      const named = docs.filter((d) => d.docType === "529_statement" && !d.ownerMemberId
        && firstName(d.fields?.["beneficiary_name"] ?? "") === firstName(c.name));
      bal = resolveFields(named).fields.ending_balance;
    }
    if (bal.value === null || !(bal.value > 0)) continue;
    accounts.push(docEntry({
      key: `529:${c.id}`,
      kind: "529",
      label: `${c.name.split(" ")[0] || c.name} 529`,
      ownerMemberId: c.id,
      ownerName: c.name,
      value: bal.value,
      asOf: bal.asOf,
      accountId: bal.source?.accountId ?? null,
      docRefs: bal.source ? [refOf(bal.source)] : [],
    }));
  }

  // Brokerage - one entry per account number, freshest statement.
  const brokerageGroups = new Map<string, DocumentRecord[]>();
  for (const d of docs) {
    if (d.docType !== "brokerage_statement") continue;
    const g = d.accountId ?? "household";
    brokerageGroups.set(g, [...(brokerageGroups.get(g) ?? []), d]);
  }
  for (const [g, group] of brokerageGroups) {
    const bal = resolveFields(group).fields.ending_balance;
    if (bal.value === null || !(bal.value > 0)) continue;
    const owner = bal.source?.ownerMemberId ? family.find((m) => m.id === bal.source!.ownerMemberId) ?? null : null;
    accounts.push(docEntry({
      key: `brokerage:${g}`,
      kind: "brokerage",
      label: "Brokerage account",
      ownerMemberId: bal.source?.ownerMemberId ?? null,
      ownerName: owner?.name ?? "",
      value: bal.value,
      asOf: bal.asOf,
      accountId: g === "household" ? null : g,
      docRefs: bal.source ? [refOf(bal.source)] : [],
    }));
  }

  // User entries: every row of the assets table becomes an entry,
  // unless a document-derived entry already covers the same
  // account - then the document keeps the balance and the row
  // contributes its label and monthly figure only.
  const memberByName = (name: string): UiMember | null =>
    family.find((m) => norm(m.name) !== "" && norm(m.name) === norm(name)) ?? null;
  for (const row of state.assets) {
    const kind: RegistryKind = row.kind === "other" && /stock|espp|rsu|equity/i.test(row.label)
      ? "employer_stock"
      : row.kind;
    const owner = row.ownerName ? memberByName(row.ownerName) : null;
    let match: RegistryAccount | undefined;
    if (kind === "401k" || kind === "ira") {
      match = accounts.find((a) => a.kind === kind && owner !== null && a.ownerMemberId === owner.id);
    } else if (kind === "hsa") {
      match = accounts.find((a) => a.kind === "hsa");
    } else if (kind === "529") {
      match = accounts.find((a) => a.kind === "529" && owner !== null && a.ownerMemberId === owner.id);
    } else if (kind === "brokerage") {
      const brokerage = accounts.filter((a) => a.kind === "brokerage");
      match = brokerage.length === 1 ? brokerage[0] : undefined;
    }
    if (match) {
      match.monthly = row.monthly;
      match.source = "document+user";
      match.userAssetId = row.id;
      if (row.label) match.label = row.label;
      continue;
    }
    accounts.push({
      key: `user:${row.id}`,
      kind,
      label: row.label || kind,
      ownerMemberId: owner?.id ?? null,
      ownerName: row.ownerName,
      value: row.value,
      monthly: row.monthly,
      source: "user",
      asOf: null,
      accountId: null,
      docRefs: [],
      userAssetId: row.id,
    });
  }

  const sum = (list: RegistryAccount[], pick: (a: RegistryAccount) => number): number =>
    round2(list.reduce((s, a) => s + pick(a), 0));
  const retirementAccounts = accounts.filter((a) => a.kind === "401k" || a.kind === "ira");
  const educationAccounts = accounts.filter((a) => a.kind === "529");
  return {
    accounts,
    byKey: new Map(accounts.map((a) => [a.key, a])),
    retirementAccounts,
    retirementTotal: sum(retirementAccounts, (a) => a.value),
    retirementMonthly: sum(retirementAccounts, (a) => a.monthly),
    educationAccounts,
    educationTotal: sum(educationAccounts, (a) => a.value),
    educationMonthly: sum(educationAccounts, (a) => a.monthly),
    hsa: accounts.find((a) => a.kind === "hsa") ?? null,
  };
}

/** The accounts one adult owns, in the retirement model's owned
 * shape - the model's historical filter (kinds 401k/ira/hsa,
 * matched by member id or by the name the user typed on the row)
 * evaluated over registry entries instead of the raw assets
 * table, so document-derived accounts are identified rows now:
 * an adult with an identified 401(k) no longer ALSO carries the
 * unmapped household fallback for the same money (round 60's
 * composition rule, fed by the registry). */
export function registryOwnedForAdult(
  registry: AssetRegistry,
  member: { id: string; name: string },
): Array<{ kind: string; value: number; monthly: number }> {
  return registry.accounts
    .filter((a) => (a.kind === "401k" || a.kind === "ira" || a.kind === "hsa")
      && (a.ownerMemberId === member.id
        || (a.ownerName.trim() !== "" && member.name.trim() !== "" && norm(a.ownerName) === norm(member.name))))
    .map((a) => ({ kind: a.kind, value: a.value, monthly: a.monthly }));
}

/** Existential signals the store derives (hasHsa and friends) -
 * from the registry, so a document-proven account counts even
 * when the user never typed a row for it. */
export function registryHasKind(registry: AssetRegistry, kind: RegistryKind): boolean {
  return registry.accounts.some((a) => a.kind === kind);
}
