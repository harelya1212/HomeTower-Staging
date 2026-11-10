// Field-level provenance, reconciliation and reprocessing
// (round 55, Copilot's ingestion doctrine):
//
// - Provenance resolves PER FIELD, never per document (workstream
//   B): several records can speak to one account, and each field's
//   value comes from the source with the freshest as-of date FOR
//   THAT FIELD. A November screenshot therefore owns the current
//   balance while the October statement keeps October's activity.
//   Two sources with the same as-of date and different values are
//   a CONFLICT - surfaced, never silently picked.
// - 529 distributions and HSA distributions each get a
//   reconciliation (workstreams C and D): the figures become Tasks
//   items with Copilot's wording. Tasks in HomeTower are DERIVED
//   from state on every render (the round-40 Tasks page), so a
//   reconciliation task exists exactly once per child/HSA per tax
//   year by construction - re-uploads cannot duplicate it.
// - Tax-year facts never move current balances (workstream E): the
//   SA forms are not statement sources for resolution at all; the
//   1099-SA feeds only its own year's distribution reconciliation.
// - Reprocessing (workstream G): when the field maps advance,
//   records that retained their extracted text are re-read with
//   the new coverage and new facts merge in - existing (confirmed)
//   values are never overwritten by a re-read of the same source.
import { extractFields } from "../engine/extract.ts";
import type { DocumentRecord } from "../engine/intake.ts";
import { payslipKey } from "./payslips.ts";
import { textToRawFields } from "./textFields.ts";
import {
  extractSectionReading,
  hsaDepositFields,
  k401DetailFields,
  parse401kDetail,
  parseHsaPageFields,
  parseSaForm,
  segmentStatement,
  statementPeriodOf,
  type StatementSection,
} from "./statementSections.ts";

export function fieldNum(fields: Record<string, string> | undefined, key: string): number | null {
  const raw = fields?.[key];
  if (raw === undefined || raw === "") return null;
  const v = Number(String(raw).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(v) ? v : null;
}

/** A record's as-of date for provenance: the statement's own
 * period end when the record carries one, else the day it was
 * captured (a screenshot's reading is as of its capture). */
export function docAsOf(d: DocumentRecord): string {
  return d.fields?.["statement_as_of"] || d.capturedOn || "";
}

/** Where a displayed figure came from, in the words the surfaces
 * use: a dated statement, or a reading captured that day. */
export function sourceLabelFor(d: DocumentRecord): string {
  const asOf = docAsOf(d);
  const date = asOf ? dateLabel(asOf) : "date unknown";
  return d.fields?.["statement_as_of"] ? `statement, ${date}` : `reading, ${date}`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function dateLabel(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso;
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}`;
}
/** "October" for an ISO date (round 57: the statement-snapshot
 * label names the statement's month). */
export function monthNameOf(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso;
  return MONTHS[Number(iso.slice(5, 7)) - 1];
}
/** "October 2026" for an ISO date (round 57: a statement period
 * figure is labelled with the period it covers). */
export function monthYearOf(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso;
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}

// ---------------------------------------------------------------------------
// Per-field resolution (workstream B)
// ---------------------------------------------------------------------------

export interface ResolvedField {
  value: number | null;
  asOf: string | null;
  source: DocumentRecord | null;
}
export interface FieldConflict {
  field: string;
  entries: { value: number; asOf: string; source: DocumentRecord }[];
}
export interface AccountResolution {
  fields: Record<string, ResolvedField>;
  conflicts: FieldConflict[];
}

const BALANCE_LIKE = ["ending_balance", "contributions_ytd", "distributions_ytd", "monthly_contribution", "contributions_period", "per_payroll_contribution"];

/** Resolve each account field from the freshest source for that
 * field. Same-date disagreement on a field is a conflict: the
 * tied entries are returned and the field itself resolves to the
 * first of them (display order), with the conflict surfaced by
 * the caller - HomeTower never hides that two sources disagree. */
export function resolveFields(docs: DocumentRecord[], fieldKeys: string[] = BALANCE_LIKE): AccountResolution {
  const fields: Record<string, ResolvedField> = {};
  const conflicts: FieldConflict[] = [];
  for (const key of fieldKeys) {
    let best: ResolvedField = { value: null, asOf: null, source: null };
    const tied: { value: number; asOf: string; source: DocumentRecord }[] = [];
    for (const d of docs) {
      const v = fieldNum(d.fields, key);
      if (v === null) continue;
      const asOf = docAsOf(d);
      if (best.value === null || asOf > (best.asOf ?? "")) {
        best = { value: v, asOf, source: d };
        tied.length = 0;
        tied.push({ value: v, asOf, source: d });
      } else if (asOf === (best.asOf ?? "")) {
        tied.push({ value: v, asOf, source: d });
      }
    }
    fields[key] = best;
    const distinct = [...new Set(tied.map((t) => t.value))];
    if (tied.length > 1 && distinct.length > 1) conflicts.push({ field: key, entries: tied });
  }
  return { fields, conflicts };
}

/** The household HSA's resolved facts: every hsa_statement record
 * is a source (the SA tax forms are NOT - workstream E). */
export function hsaResolution(docs: DocumentRecord[]): AccountResolution {
  return resolveFields(eligibleDocs(docs).filter((d) => d.docType === "hsa_statement"));
}

// ---------------------------------------------------------------------------
// ROUND 62 (trust layer) - cross-account contamination: the screen,
// the read-path defense and the load-time repair.
// ---------------------------------------------------------------------------
//
// Round 60's validateCanonicalEvidence guards the SAVE path. It
// cannot help a record that is already stored - and the owner's
// device holds exactly one: an hsa_statement whose ending_balance
// is the Fidelity sidebar's 401(k) figure ($271,019.12), captured
// 2026-11-09 with no statement_as_of, so per-field freshness made
// it the HSA's current balance over the October statement. Three
// layers close it:
//
// (a) the extraction root is fixed in parseHsaPageFields
//     (statementSections.ts): an HSA page's balance is read from
//     the HSA's own block, never from a sidebar account's block.
// (b) repairContaminatedDocuments (below) runs on every load: a
//     contaminated record is re-derived from its retained text
//     with the corrected reader; what cannot be cleanly
//     re-derived is QUARANTINED - kept in state, excluded from
//     every resolution, and reported in the reprocess banner.
// (c) the read-path defense: eligibleDocs excludes quarantined
//     and currently-contaminated records from every resolution,
//     so a contaminated record never wins a field even before
//     the repair has run - freshness never rehabilitates a fact
//     that fails cross-account validation.

/** Indices of hsa_statement records whose ending balance matches
 * a KNOWN 401(k) balance (another record's 401k_statement ending
 * balance) within $1 - round 60's rule 1 applied to stored state.
 * Quarantined records are already excluded and are not re-flagged. */
export function contaminatedHsaIndices(docs: DocumentRecord[]): Set<number> {
  const known: number[] = [];
  for (const d of docs) {
    if (d.docType !== "401k_statement") continue;
    const v = fieldNum(d.fields, "ending_balance");
    if (v !== null && v > 0) known.push(v);
  }
  const out = new Set<number>();
  docs.forEach((d, i) => {
    if (d.docType !== "hsa_statement" || d.quarantined) return;
    const b = fieldNum(d.fields, "ending_balance");
    if (b === null || b <= 0) return;
    if (known.some((k) => Math.abs(k - b) <= 1)) out.add(i);
  });
  return out;
}

/** The records a resolution may read: never quarantined, never
 * currently contaminated. Every account resolution in this module
 * (and the asset registry) reads through this filter. */
export function eligibleDocs(docs: DocumentRecord[]): DocumentRecord[] {
  const bad = contaminatedHsaIndices(docs);
  if (bad.size === 0 && !docs.some((d) => d.quarantined)) return docs;
  return docs.filter((d, i) => !d.quarantined && !bad.has(i));
}

export interface RepairResult {
  docs: DocumentRecord[];
  notes: string[];
  repaired: number;
  quarantined: number;
}

/** The load-time repair (R62-1b). For every contaminated HSA
 * record: re-derive the page-owned fields (ending balance, total
 * contributions, employer contribution) from the retained text
 * with the corrected page reader. A field the corrected reader
 * does not find on the page is REMOVED - the stored figure came
 * from the same broken read and is unknown, not a documented
 * zero (R62-3). When no clean re-derivation exists (no retained
 * text, no balance found, or the re-derived balance still
 * matches the 401(k)), the record is quarantined instead.
 * Idempotent: a repaired record no longer matches, and a
 * quarantined record is never re-processed, so later loads are
 * silent. Pure: the caller persists the result. */
export function repairContaminatedDocuments(docs: DocumentRecord[]): RepairResult {
  const bad = contaminatedHsaIndices(docs);
  if (bad.size === 0) return { docs, notes: [], repaired: 0, quarantined: 0 };
  const known401k: number[] = [];
  for (const d of docs) {
    if (d.docType !== "401k_statement") continue;
    const v = fieldNum(d.fields, "ending_balance");
    if (v !== null && v > 0) known401k.push(v);
  }
  const notes: string[] = [];
  let repaired = 0;
  let quarantined = 0;
  const out = docs.map((doc, i) => {
    if (!bad.has(i)) return doc;
    const stored = fieldNum(doc.fields, "ending_balance");
    const label = `an HSA reading captured ${doc.capturedOn ?? "on an unknown date"}`;
    let candidate: number | null = null;
    let pageFields: Record<string, string> = {};
    if (doc.rawText) {
      try {
        const r = extractFields(parseHsaPageFields(doc.rawText), "hsa_statement");
        pageFields = Object.fromEntries(Object.entries(r.fields).map(([k, v]) => [k, String(v)]));
        const c = fieldNum(pageFields, "ending_balance");
        if (c !== null && c > 0 && !known401k.some((k) => Math.abs(k - c) <= 1)) candidate = c;
      } catch { /* no clean re-derivation: quarantine below */ }
    }
    if (candidate !== null && stored !== null && Math.abs(candidate - stored) > 0.005) {
      const fields: Record<string, string> = { ...(doc.fields ?? {}) };
      for (const key of ["ending_balance", "total_contributions", "employer_contribution"]) {
        if (pageFields[key] !== undefined && pageFields[key] !== "") fields[key] = pageFields[key];
        else delete fields[key];
      }
      repaired++;
      notes.push(`HomeTower repaired ${label}: its balance had been read from another account on the same page (${money2(stored)}). Re-read from the HSA's own part of the page, the balance is ${money2(candidate)} - the wrong figure no longer feeds any balance or forecast.`);
      return { ...doc, fields };
    }
    quarantined++;
    notes.push(`HomeTower quarantined ${label}: its balance (${stored !== null ? money2(stored) : "unknown"}) matches a known 401(k) account and the original page could not be re-read cleanly, so the reading no longer feeds any balance or forecast. Upload the HSA page again to restore it.`);
    return {
      ...doc,
      quarantined: true,
      quarantineReason: "Balance matches a known 401(k) account; the original page could not be re-read cleanly.",
    };
  });
  return { docs: out, notes, repaired, quarantined };
}

export interface HsaBalanceSnapshots {
  /** The resolved current balance (freshest source for the field). */
  current: ResolvedField;
  /** The freshest STATEMENT balance dated strictly earlier than
   * the current balance's as-of, when one exists: an earlier
   * snapshot of the same account, not a conflict and not a loser
   * of the resolution - the card shows both, dated (round 57). */
  statementSnapshot: { value: number; asOf: string; source: DocumentRecord } | null;
}

/** The HSA's two-snapshot view (round 57): a November screenshot
 * balance and the October statement balance are two snapshots at
 * different times. The resolution picks the current figure per
 * field as always; this model additionally keeps the earlier
 * dated STATEMENT snapshot visible instead of letting it vanish
 * behind the newer reading. Only statement-sourced balances
 * (records carrying a statement period end) can be the snapshot,
 * and only when strictly earlier than the current balance. */
export function hsaBalanceSnapshots(docs: DocumentRecord[]): HsaBalanceSnapshots {
  const stmts = eligibleDocs(docs).filter((d) => d.docType === "hsa_statement");
  const current = resolveFields(stmts).fields.ending_balance;
  let statementSnapshot: HsaBalanceSnapshots["statementSnapshot"] = null;
  if (current.value !== null && current.asOf) {
    for (const d of stmts) {
      if (!d.fields?.["statement_as_of"]) continue;
      const v = fieldNum(d.fields, "ending_balance");
      if (v === null) continue;
      const asOf = docAsOf(d);
      if (!(asOf < current.asOf)) continue;
      if (!statementSnapshot || asOf > statementSnapshot.asOf) statementSnapshot = { value: v, asOf, source: d };
    }
  }
  return { current, statementSnapshot };
}

/** One child's resolved 529 facts, from the statements assigned to
 * that child on their confirm cards. */
export function eduResolutionFor(docs: DocumentRecord[], childId: string): AccountResolution {
  return resolveFields(eligibleDocs(docs).filter((d) => d.docType === "529_statement" && d.ownerMemberId === childId));
}

/** ROUND 59 (TRACE D) - the household 529 pace: the freshest
 * statement's stated monthly contribution PER CHILD, summed
 * across children. The headline used to keep whichever statement
 * record happened to be iterated LAST (one child's pace - $150
 * for the youngest - presented as the household figure while the
 * per-child lines below it were all correct). A child with a
 * newer statement replaces their own pace, never adds to it. */
export function eduMonthlyTotal(
  docs: DocumentRecord[],
  children: { id: string; name: string }[],
): { total: number; perChild: { childId: string; name: string; monthly: number }[] } {
  const perChild: { childId: string; name: string; monthly: number }[] = [];
  const pool = eligibleDocs(docs);
  for (const child of children) {
    let owned = pool.filter((d) => d.docType === "529_statement" && d.ownerMemberId === child.id);
    if (!owned.length && firstName(child.name)) {
      owned = pool.filter((d) => d.docType === "529_statement" && !d.ownerMemberId
        && firstName(d.fields?.["beneficiary_name"] ?? "") === firstName(child.name));
    }
    let best: { monthly: number; asOf: string } | null = null;
    for (const d of owned) {
      const v = fieldNum(d.fields ?? {}, "monthly_contribution");
      if (v === null || v <= 0) continue;
      const asOf = docAsOf(d);
      if (!best || asOf >= best.asOf) best = { monthly: v, asOf };
    }
    if (best) perChild.push({ childId: child.id, name: child.name, monthly: best.monthly });
  }
  const total = Math.round(perChild.reduce((s, p) => s + p.monthly, 0) * 100) / 100;
  return { total, perChild };
}

/** ROUND 59 (TRACE C, Copilot's remedy shape) - the HSA
 * contribution reconciliation the card renders. The governing
 * rule: "HSA household contribution YTD != blindly sum every
 * historical payroll HSA line." The statement on file confirms
 * ONE account (its owner's); payroll YTD is resolved per earner
 * from each earner's FRESHEST slip snapshot (never a sum of
 * snapshots - payslipDeductionTotals already resolves it that
 * way); the delta reconciles the ACCOUNT OWNER's payroll YTD
 * against the statement's confirmed YTD for that same account.
 * A second earner's payroll HSA is a different account and is
 * reported on its own line - it never enters the delta. The
 * delta is "explained" when it is zero within rounding (the two
 * sources agree); any other delta is unexplained and the card's
 * status badge must say so instead of UP TO DATE. */
export interface HsaContributionRecon {
  ownerName: string | null;
  ownerPayrollYtd: number | null;
  otherHouseholdYtd: number;
  statementYtd: number | null;
  statementAsOf: string | null;
  delta: number | null;
  explained: boolean;
}
export function hsaContributionReconciliation(
  docs: DocumentRecord[],
  perEarner: { name: string; hsaYtd: number | null }[],
  members: { id: string; name: string }[],
): HsaContributionRecon {
  // The freshest HSA statement reading on file: its owner and its
  // own confirmed contributions YTD.
  let stmt: DocumentRecord | null = null;
  for (const d of eligibleDocs(docs)) {
    if (d.docType !== "hsa_statement") continue;
    if (!stmt || docAsOf(d) >= docAsOf(stmt)) stmt = d;
  }
  const statementYtd = stmt ? fieldNum(stmt.fields ?? {}, "contributions_ytd") : null;
  const ownerMember = stmt?.ownerMemberId ? members.find((m) => m.id === stmt!.ownerMemberId) ?? null : null;
  const ownerFirst = ownerMember ? firstName(ownerMember.name) : "";
  const ownerEntry = ownerFirst
    ? perEarner.find((e) => firstName(e.name ?? "") === ownerFirst) ?? null
    : null;
  const ownerPayrollYtd = ownerEntry ? ownerEntry.hsaYtd : null;
  const otherHouseholdYtd = Math.round(
    perEarner
      .filter((e) => e !== ownerEntry && e.hsaYtd !== null && e.hsaYtd > 0)
      .reduce((s, e) => s + (e.hsaYtd ?? 0), 0) * 100,
  ) / 100;
  const delta = ownerPayrollYtd !== null && statementYtd !== null
    ? Math.round((ownerPayrollYtd - statementYtd) * 100) / 100
    : null;
  return {
    ownerName: ownerMember?.name ?? ownerEntry?.name ?? null,
    ownerPayrollYtd,
    otherHouseholdYtd,
    statementYtd,
    statementAsOf: stmt ? docAsOf(stmt) : null,
    delta,
    explained: delta === null || Math.abs(delta) <= 0.5,
  };
}

// ---------------------------------------------------------------------------
// Reconciliations (workstreams C and D)
// ---------------------------------------------------------------------------

export interface HsaReconYear {
  year: number;
  distributions: number;
  matched: number;
  unverified: number;
  source: "1099-SA" | "statement";
}

/** HSA distributions per tax year. A year's filed figure (Form
 * 1099-SA box 1) is authoritative for that year when it exists;
 * otherwise the freshest statement distributions figure whose
 * as-of falls in the year. Years are never merged. */
export function hsaReconciliation(docs: DocumentRecord[], matchedByYear: Record<string, number>): HsaReconYear[] {
  const byYear = new Map<number, { distributions: number; source: "1099-SA" | "statement"; asOf: string }>();
  for (const d of eligibleDocs(docs)) {
    if (d.docType !== "hsa_statement") continue;
    const dist = fieldNum(d.fields, "distributions_ytd");
    if (dist === null || dist <= 0) continue;
    const asOf = docAsOf(d);
    const year = Number((asOf || d.capturedOn || "").slice(0, 4));
    if (!(year > 1900)) continue;
    const cur = byYear.get(year);
    if (!cur || asOf > cur.asOf) byYear.set(year, { distributions: dist, source: "statement", asOf });
  }
  for (const d of docs) {
    if (d.docType !== "hsa_1099_sa") continue;
    const dist = fieldNum(d.fields, "box_1_gross_distribution");
    const year = fieldNum(d.fields, "tax_year");
    if (dist === null || year === null) continue;
    if (dist > 0) byYear.set(year, { distributions: dist, source: "1099-SA", asOf: docAsOf(d) });
    else byYear.delete(year);
  }
  return [...byYear.entries()]
    .map(([year, v]) => {
      const matched = Math.max(0, matchedByYear[String(year)] ?? 0);
      return { year, distributions: v.distributions, matched, unverified: Math.max(0, v.distributions - matched), source: v.source };
    })
    .sort((a, b) => b.year - a.year);
}

export interface ReconTask { key: string; icon: string; title: string; detail: string; target: string }

const money0 = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const money2 = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function firstName(name: string): string {
  return (name || "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
}

export interface EduReconYear {
  year: number;
  distributions: number;
  verified: number;
  unverified: number;
  asOf: string;
}

/** The state key for one child's verified education expenses in
 * one tax year (the persisted eduVerifiedExpenses record). */
export function eduVerifiedKey(childId: string, year: number): string {
  return `${childId}:${year}`;
}

/** One child's 529 distributions per tax year against the
 * education-expense evidence the user has verified - the exact
 * mirror of hsaReconciliation (round 58): the distributions side
 * is document-derived (the freshest reading per year), the
 * verified side is the user's own count, and the task lifecycle
 * reads the difference. A record assigned to the child wins; an
 * unassigned record still counts via the printed beneficiary
 * name, as the tasks have always resolved it. */
export function eduReconYearsFor(
  docs: DocumentRecord[],
  child: { id: string; name: string },
  verifiedByChildYear: Record<string, number>,
): EduReconYear[] {
  let owned = eligibleDocs(docs).filter((d) => d.docType === "529_statement" && d.ownerMemberId === child.id);
  if (!owned.length && firstName(child.name)) {
    owned = eligibleDocs(docs).filter((d) => d.docType === "529_statement" && !d.ownerMemberId
      && firstName(d.fields?.["beneficiary_name"] ?? "") === firstName(child.name));
  }
  const byYear = new Map<number, { dist: number; asOf: string }>();
  for (const d of owned) {
    const dist = fieldNum(d.fields, "distributions_ytd");
    if (dist === null || dist <= 0) continue;
    const asOf = docAsOf(d);
    const year = Number((asOf || d.capturedOn || "").slice(0, 4));
    if (!(year > 1900)) continue;
    const cur = byYear.get(year);
    if (!cur || asOf > cur.asOf) byYear.set(year, { dist, asOf });
  }
  return [...byYear.entries()]
    .map(([year, v]) => {
      const verified = Math.max(0, verifiedByChildYear[eduVerifiedKey(child.id, year)] ?? 0);
      return { year, distributions: v.dist, verified, unverified: Math.max(0, v.dist - verified), asOf: v.asOf };
    })
    .sort((a, b) => b.year - a.year);
}

/** The reconciliation tasks (derived, so one per child/HSA per tax
 * year by construction). Wording is Copilot's, verbatim in shape:
 * the 529 task names the rounded distributions and the tax year;
 * the HSA task names the exact distributions and carries the
 * receipts shape. Unverified never reads as taxable. Round 58:
 * both tasks track an UNRESOLVED remainder - evidence the user
 * verifies (receipts matched, education expenses verified)
 * shrinks the figure the task names, and at $0 the task is gone. */
export function reconciliationTasks(
  docs: DocumentRecord[],
  children: { id: string; name: string }[],
  matchedByYear: Record<string, number>,
  eduVerifiedByChildYear: Record<string, number> = {},
): ReconTask[] {
  const tasks: ReconTask[] = [];
  for (const child of children) {
    for (const y of eduReconYearsFor(docs, child, eduVerifiedByChildYear)) {
      if (y.unverified <= 0) continue;
      tasks.push({
        key: `recon529-${child.id}-${y.year}`,
        icon: "🎓",
        title: `${money0(y.unverified)} of ${y.year} 529 distributions detected. Qualified education expense evidence needs reconciliation.`,
        detail: `Read from ${child.name || "your child"}'s 529 statement (${dateLabel(y.asOf)}). 529 distributions ${money0(y.distributions)} / Education expenses verified ${money0(y.verified)} / Still unverified ${money0(y.unverified)} (${y.year}). Bursar ledgers, tuition receipts and scholarship records are the evidence - add them in Documents. Unverified does not mean non-qualified - this is an evidence reminder, not a tax conclusion.`,
        target: "Documents",
      });
    }
  }
  for (const y of hsaReconciliation(docs, matchedByYear)) {
    if (y.unverified <= 0) continue;
    tasks.push({
      key: `reconhsa-${y.year}`,
      icon: "🩺",
      title: `HSA receipts verification: ${money2(y.distributions)} distributions detected.`,
      detail: `HSA distributions ${money0(y.distributions)} / Receipts matched ${money0(y.matched)} / Still unverified ${money0(y.unverified)} (${y.year}${y.source === "1099-SA" ? ", per Form 1099-SA" : ""}). Missing receipts do not make a distribution taxable - this is an evidence reminder, not a tax conclusion.`,
      target: "Documents",
    });
  }
  return tasks;
}

// ---------------------------------------------------------------------------
// Dedupe on save (round 58, Copilot's idempotency condition)
// ---------------------------------------------------------------------------
//
// A re-upload of a document the app already holds must refresh the
// existing evidence, never stack a second copy: same document ->
// update/reconcile in place -> no duplicate financial facts. Two
// identity signals, checked in this order at every save:
//
// 1. The content FINGERPRINT: an FNV-1a 32-bit hash of the
//    normalized extracted text (lowercased, whitespace collapsed),
//    stored on the record at save and at reprocess. The same file
//    read again produces the same text and therefore the same
//    fingerprint. Texts that normalize to fewer than
//    FINGERPRINT_MIN_CHARS characters never fingerprint-match - a
//    near-empty read is not an identity. A record saved before
//    fingerprints existed recomputes its own from the retained
//    rawText, so older saves dedupe too.
// 2. A SEMANTIC KEY per document kind, for a corrected reading of
//    the same document whose text (and fingerprint) changed:
//    payslip = earner + period end; a fanned statement section =
//    account + period end; a standalone 401(k) statement = owner
//    + period end; a standalone 529/HSA statement = owner +
//    period end; an SA tax form = type + tax year + account; an
//    SSA statement = member + statement date (fingerprint only
//    when the reading carries no statement date). Every save path
//    goes through upsertDocument - the fan-out replace and the
//    payslip replace that rounds 55/56 built by hand are this one
//    path now.

/** Normalized text is the fingerprint's input: case and spacing
 * differences between two reads of one document never change its
 * identity. */
export function normalizeTextForFingerprint(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** FNV-1a 32-bit over the normalized text, with the normalized
 * length appended - deterministic, dependency-free, and stable
 * across runs and platforms. */
export function fingerprintText(text: string): string {
  const norm = normalizeTextForFingerprint(text);
  let h = 0x811c9dc5;
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `fnv1a:${(h >>> 0).toString(16).padStart(8, "0")}:${norm.length}`;
}

export const FINGERPRINT_MIN_CHARS = 40;

/** The fingerprint to stamp on a fresh save of this text, or null
 * when the text is too short to be an identity. */
export function fingerprintForSave(text: string): string | null {
  return normalizeTextForFingerprint(text).length >= FINGERPRINT_MIN_CHARS ? fingerprintText(text) : null;
}

/** A record's fingerprint: the stored stamp when it has one, else
 * recomputed from its retained text (records saved before round
 * 58 carry no stamp but do carry their text). */
export function recordFingerprint(d: DocumentRecord): string | null {
  if (d.fingerprint) return d.fingerprint;
  if (d.rawText && normalizeTextForFingerprint(d.rawText).length >= FINGERPRINT_MIN_CHARS) return fingerprintText(d.rawText);
  return null;
}

/** The semantic identity of a reading, per document kind (see the
 * section header). Null when the reading does not carry the facts
 * its kind's key needs - such a reading dedupes by fingerprint
 * only, and a genuinely new document always appends. */
/** Account strings compare without punctuation or spacing: the
 * same account can be stored as "231-851100" by one build and
 * read back with different spacing by another (round 59). */
const normAcctForKey = (s: string): string => s.replace(/[^0-9A-Za-z]/g, "");

export function semanticKeyFor(d: DocumentRecord): string | null {
  const f = d.fields ?? {};
  const asOf = f["statement_as_of"] ?? "";
  if (d.docType === "hsa_1099_sa" || d.docType === "hsa_5498_sa") {
    const year = f["tax_year"] ?? "";
    if (!year) return null;
    return `${d.docType}|yr:${year}|acct:${normAcctForKey(f["account_id"] ?? d.accountId ?? "")}`;
  }
  if (d.docType === "payslip") {
    const k = payslipKey(f);
    return k ? `payslip|${k}` : null;
  }
  if (d.accountId) {
    return asOf ? `${d.docType}|acct:${d.accountId}|${asOf}` : null;
  }
  if (d.docType === "401k_statement") {
    return d.ownerMemberId && asOf ? `401k_statement|owner:${d.ownerMemberId}|${asOf}` : null;
  }
  if (d.docType === "529_statement" || d.docType === "hsa_statement") {
    return asOf ? `${d.docType}|owner:${d.ownerMemberId ?? ""}|${asOf}` : null;
  }
  if (d.docType === "ssa_statement") {
    const date = f["statement_as_of"] || f["source_date"] || f["statement_date"] || "";
    return d.ownerMemberId && date ? `ssa_statement|owner:${d.ownerMemberId}|${date}` : null;
  }
  return null;
}

/** ROUND 59 (TRACE B) - the figure-fallback identity, for records
 * whose primary key cannot be computed on one side: a form saved
 * before round 58 whose fields never carried an account_id, a
 * 401(k) reading never assigned an owner, a fanned section whose
 * accountId was not stored. When the account/owner half of the
 * primary key is missing, the document's own headline figures ARE
 * its identity: tax year + contribution total + market value for
 * a 5498-SA, tax year + gross distribution for a 1099-SA, period
 * end + ending balance for a statement reading. Two genuinely
 * different documents colliding here would need the same kind,
 * the same period, and every headline figure identical to the
 * cent - and a refresh between two such readings replaces
 * like with like. */
const keyNum = (v: string | undefined): string => {
  if (v === undefined || v === "") return "";
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? String(n) : "";
};
export function fallbackKeyFor(d: DocumentRecord): string | null {
  const f = d.fields ?? {};
  if (d.docType === "hsa_5498_sa") {
    const b2 = keyNum(f["box_2_total_contributions"]);
    const b5 = keyNum(f["box_5_fair_market_value"]);
    return f["tax_year"] && b2 && b5 ? `hsa_5498_sa|fig:${f["tax_year"]}:${b2}:${b5}` : null;
  }
  if (d.docType === "hsa_1099_sa") {
    const b1 = keyNum(f["box_1_gross_distribution"]);
    return f["tax_year"] && b1 ? `hsa_1099_sa|fig:${f["tax_year"]}:${b1}:${f["box_3_distribution_code"] ?? ""}` : null;
  }
  if (d.docType === "401k_statement") {
    const bal = keyNum(f["ending_balance"]);
    return f["statement_as_of"] && bal ? `401k_statement|fig:${f["statement_as_of"]}:${bal}` : null;
  }
  if (d.docType === "529_statement" || d.docType === "hsa_statement") {
    // Computed whether or not an accountId is stored: the rung is
    // only consulted when the primary keys already missed, which
    // is exactly the asymmetric case (one side carries the
    // accountId in its key, the other keyed by owner).
    const bal = keyNum(f["ending_balance"]);
    return f["statement_as_of"] && bal
      ? `${d.docType}|fig:${f["statement_as_of"]}:${bal}:${(f["beneficiary_name"] ?? "").trim().toLowerCase()}`
      : null;
  }
  return null;
}

/** Every identity a record carries, strongest first - shared by
 * the save path and the load-time sweep so both dedupe by exactly
 * the same ladder. */
function identityKeysFor(d: DocumentRecord): string[] {
  const keys: string[] = [];
  const fp = recordFingerprint(d);
  if (fp) keys.push(`${d.docType}|fp:${fp}`);
  const sk = semanticKeyFor(d);
  if (sk) keys.push(`sk:${sk}`);
  const fb = fallbackKeyFor(d);
  if (fb) keys.push(`fb:${fb}`);
  return keys;
}

/** ROUND 59 (TRACE B) - the load-time dedupe sweep. Round 58's
 * upsert only dedupes NEW saves; a duplicate pair already sitting
 * in stored state (a pre-round-58 form record the semantic key
 * missed, re-saved as a second record) would render twice
 * forever. On every load, records whose identities collide on
 * ANY rung of the ladder merge into one: the fuller reading wins
 * field conflicts, the union of both readings' fields survives,
 * and text/stamps come from whichever record carries them. This
 * is the dedupe step of the standing governance flow (reprocess
 * -> dedupe -> reconcile), applied to state as loaded, so
 * existing duplicates heal without any re-upload. */
export function dedupeStoredDocuments(docs: DocumentRecord[]): { docs: DocumentRecord[]; merged: number } {
  const seen = new Map<string, number>();
  const out: DocumentRecord[] = [];
  let merged = 0;
  for (const d of docs) {
    const keys = identityKeysFor(d);
    let slot = -1;
    for (const k of keys) {
      const s = seen.get(k);
      if (s !== undefined) { slot = s; break; }
    }
    if (slot < 0) {
      for (const k of keys) seen.set(k, out.length);
      out.push(d);
      continue;
    }
    const prev = out[slot];
    const count = (r: DocumentRecord) => Object.keys(r.fields ?? {}).length;
    const fuller = count(d) > count(prev) ? d : prev;
    const other = fuller === d ? prev : d;
    const combined: DocumentRecord = {
      ...other,
      ...fuller,
      fields: { ...(other.fields ?? {}), ...(fuller.fields ?? {}) },
      rawText: fuller.rawText ?? other.rawText,
      fingerprint: fuller.fingerprint ?? other.fingerprint,
      capturedOn: fuller.capturedOn ?? other.capturedOn,
      ownerMemberId: fuller.ownerMemberId ?? other.ownerMemberId,
      accountId: fuller.accountId ?? other.accountId,
    };
    out[slot] = combined;
    for (const k of identityKeysFor(combined)) if (!seen.has(k)) seen.set(k, slot);
    merged++;
  }
  return { docs: merged > 0 ? out : docs, merged };
}

export interface UpsertResult {
  docs: DocumentRecord[];
  /** Where the reading landed: the replaced record's slot, or the
   * append position for a genuinely new document. */
  index: number;
  /** True when the save refreshed an existing document in place
   * (by fingerprint or by semantic key) instead of appending. */
  refreshed: boolean;
}

/** The single save path for every reading (round 58): fingerprint
 * match first, then the kind's semantic key, else append. A
 * refresh replaces the record in its own slot with the new
 * reading - refreshed facts and stamps - and keeps the earlier
 * record's owner assignment when the new reading carries none,
 * so a re-upload can never un-assign a document. */
export function upsertDocument(docs: DocumentRecord[], record: DocumentRecord): UpsertResult {
  let idx = -1;
  const fp = recordFingerprint(record);
  if (fp) idx = docs.findIndex((d) => d.docType === record.docType && recordFingerprint(d) === fp);
  if (idx < 0) {
    const key = semanticKeyFor(record);
    if (key) idx = docs.findIndex((d) => semanticKeyFor(d) === key);
  }
  if (idx < 0) {
    // Round 59 (TRACE B): the figure-fallback identity - a legacy
    // record whose primary key cannot be computed (no account_id
    // stored, no owner assigned) still dedupes on re-upload.
    const fb = fallbackKeyFor(record);
    if (fb) idx = docs.findIndex((d) => fallbackKeyFor(d) === fb);
  }
  if (idx < 0) return { docs: [...docs, record], index: docs.length, refreshed: false };
  const existing = docs[idx];
  const merged: DocumentRecord = record.ownerMemberId || !existing.ownerMemberId
    ? record
    : { ...record, ownerMemberId: existing.ownerMemberId };
  const out = docs.slice();
  out[idx] = merged;
  return { docs: out, index: idx, refreshed: true };
}

// ---------------------------------------------------------------------------
// Canonical cross-account validation (round 60, P0-B)
// ---------------------------------------------------------------------------
//
// "Dedupe prevents duplication. It does not prevent a wrong
// fact." (Copilot.) The save path used to run extract -> confirm
// -> build record -> upsertDocument with no layer asking whether
// the fact about to be written contradicts a fact the household
// already holds. validateCanonicalEvidence is that layer: every
// save (single confirm, fan-out section) runs it BEFORE
// upsertDocument, and a blocking verdict means the reading is
// NOT saved - the confirm flow shows the block and the user
// decides what the document really is.
//
// The rules guard the HSA classification, the confusion the
// evidence actually produces (an HSA page and a 401(k) statement
// from the same provider look alike and carry alike figures):
//
// 1. CROSS-ACCOUNT BALANCE MATCH: a proposed HSA ending balance
//    within $1 of a KNOWN 401(k) balance (an owned 401(k)
//    statement on file, or a 401(k) asset row) blocks. The
//    balance is the account's identity figure - two different
//    accounts do not share it to the dollar.
// 2. HSA IDENTITY: saving as an HSA requires at least two HSA
//    identity signals AND balance-local HSA context. The signals
//    are Copilot's phrase list, plus two structural anchors the
//    extraction itself establishes: a statement section the
//    segmenter split out on the account's own header (account id
//    + statement period + the header phrase opening the span),
//    and HSA deposit detail read from the section (per-payroll
//    deposits exist only in HSA activity). Balance-local means
//    an identity phrase appears within 600 characters of the
//    balance figure in the text; a fields-only record (no text
//    occurrence) is local when it carries HSA activity facts,
//    which are only ever read from HSA-context lines.
// 3. RETIREMENT IDENTITY: two or more distinct retirement
//    signal types (NetBenefits, 401(k), vested, Roth in-plan,
//    415 limit, retirement savings plan) alongside the balance
//    block an HSA save. One stray mention does not - the real
//    Fidelity HSA page itself carries a "Go to NetBenefits"
//    link, and the real combined statement's HSA section
//    mentions "vested" once, deep in its holdings; both are
//    pinned as saves. The NetBenefits statement carries five.
// 4. Magnitude alone never blocks: a large HSA is possible, so
//    no rule here reads the balance's size, only its identity.

export const HSA_IDENTITY_PHRASES = [
  "health savings account", "hsa contribution", "family limit",
  "qualified medical", "amount contributed", "employer contribution",
];
export const RETIREMENT_IDENTITY_SIGNALS = [
  "netbenefits", "401(k)", "401k", "vested", "roth in-plan", "415 limit", "retirement savings plan",
];
export const NEEDS_REVIEW_BALANCE_MATCH = "This balance matches a known 401(k) account.";

export interface CanonicalValidation {
  status: "ok" | "needs_review";
  /** User-facing blocking lines, in the order to show them. */
  reasons: string[];
  hsaPhrases: string[];
  identityCount: number;
  retirementTypes: string[];
  balanceLocal: boolean;
  matched401kBalance: number | null;
}

const money2str = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function validateCanonicalEvidence(input: {
  proposedRecord: DocumentRecord;
  existingDocuments: DocumentRecord[];
  householdAccounts?: { kind: string; value: number }[];
  extractedFacts?: Record<string, string>;
}): CanonicalValidation {
  const rec = input.proposedRecord;
  const facts = input.extractedFacts ?? rec.fields ?? {};
  const clean: CanonicalValidation = { status: "ok", reasons: [], hsaPhrases: [], identityCount: 0, retirementTypes: [], balanceLocal: false, matched401kBalance: null };
  // The rules guard HSA saves; every other type passes (a wrong
  // fact of another kind is a classification question, already
  // the confirm card's own check).
  if (rec.docType !== "hsa_statement") return clean;

  const text = (rec.rawText ?? "").toLowerCase();
  const balance = fieldNum(facts, "ending_balance");
  const hsaPhrases = HSA_IDENTITY_PHRASES.filter((p) => text.includes(p));
  const retirementTypes = [...new Set(RETIREMENT_IDENTITY_SIGNALS.filter((s) => text.includes(s)))];

  // Structural anchors the extraction itself established.
  let identityCount = hsaPhrases.length;
  const headerAnchor = !!rec.accountId && !!facts["statement_as_of"]
    && text.slice(0, 300).includes("health savings account");
  if (headerAnchor) identityCount += 1;
  const hasDepositDetail = facts["per_payroll_contribution"] !== undefined || facts["deposit_detail"] !== undefined;
  if (hasDepositDetail) identityCount += 1;

  // Balance-local HSA context.
  let balanceLocal = false;
  if (balance !== null && balance > 0 && text) {
    const forms = [
      balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      String(balance),
    ];
    let idx = -1;
    for (const f of forms) { const i = text.indexOf(f.toLowerCase()); if (i >= 0) { idx = i; break; } }
    if (idx >= 0) {
      const win = text.slice(Math.max(0, idx - 600), idx + 600);
      balanceLocal = HSA_IDENTITY_PHRASES.some((p) => win.includes(p));
    } else {
      balanceLocal = facts["contributions_ytd"] !== undefined || facts["distributions_ytd"] !== undefined || hasDepositDetail;
    }
  } else if (balance === null) {
    // No balance figure at all: nothing for the locality rule to
    // attach to - locality is a property of a balance reading.
    balanceLocal = true;
  }

  const reasons: string[] = [];
  let matched401kBalance: number | null = null;
  if (balance !== null && balance > 0) {
    const known: number[] = [];
    for (const d of input.existingDocuments) {
      if (d.docType !== "401k_statement") continue;
      const v = fieldNum(d.fields, "ending_balance");
      if (v !== null && v > 0) known.push(v);
    }
    for (const a of input.householdAccounts ?? []) {
      if (a.kind === "401k" && a.value > 0) known.push(a.value);
    }
    const hit = known.find((k) => Math.abs(k - balance) <= 1);
    if (hit !== undefined) {
      matched401kBalance = hit;
      reasons.push(NEEDS_REVIEW_BALANCE_MATCH);
      reasons.push(`The balance on this reading (${money2str(balance)}) equals the 401(k) balance HomeTower already holds (${money2str(hit)}). It was not saved as a health savings account.`);
    }
    if (retirementTypes.length >= 2) {
      reasons.push(`This page carries 401(k) statement identity (${retirementTypes.join(", ")}) alongside its balance, so HomeTower will not save it as a health savings account.`);
    }
  }
  if (balance !== null && balance > 0 && (identityCount < 2 || !balanceLocal)) {
    reasons.push("HomeTower could not confirm this is a health savings account: an HSA saving needs at least two HSA identity signals with HSA context next to the balance. This reading was not saved as an HSA.");
  }
  return {
    status: reasons.length > 0 ? "needs_review" : "ok",
    reasons, hsaPhrases, identityCount, retirementTypes, balanceLocal, matched401kBalance,
  };
}

// ---------------------------------------------------------------------------
// Reprocessing (workstream G)
// ---------------------------------------------------------------------------

export function mapsVersionParts(v: string | null | undefined): [number, number] {
  const m = /^(\d+)\.(\d+)/.exec(v ?? "");
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
}
function versionBehind(have: string | null | undefined, current: string): boolean {
  const [a, b] = mapsVersionParts(have);
  const [c, d] = mapsVersionParts(current);
  return a < c || (a === c && b < d);
}

export interface ReprocessResult { docs: DocumentRecord[]; notes: string[] }

/** The extractor/parser generation (round 57). Generation 1 is
 * the round-55/56 reader. Generation 2 adds the HSA deposit
 * detail (per-payroll contribution read from the statement's own
 * deposit lines). Every save and every reprocess stamps the
 * record with the generation that read it, and the pass below
 * re-reads a record whose stamp is behind EVEN WHEN its field
 * maps are current - a parser improvement alone reaches saved
 * records, no re-upload. Records saved before stamping existed
 * carry no stamp and are governed by their mapsVersion alone. */
export const EXTRACTOR_VERSION = 2;

/** Retained-text bound (round 55, raised round 57). Measured on
 * the owner's real combined statement (October 2026, 20 pages,
 * four accounts): the full extracted text is 38,856 characters
 * and its HSA section - near the END of the document - is 28,671.
 * The old 60,000 cap held that file, but with only ~55% headroom:
 * a longer statement would have its tail sections silently cut
 * out of every future re-read. The bound is now 200,000 - over
 * 5x the largest real document - so a whole statement's text is
 * retained; local storage holds it easily. */
const RAW_CAP = 200000;
export const boundRawText = (t: string): string => (t.length > RAW_CAP ? t.slice(0, RAW_CAP) : t);
export const RAW_TEXT_CAP = RAW_CAP;

function nameMatch(personPrinted: string | null, members: { id: string; name: string; role: string }[], roles: string[]): string | null {
  if (!personPrinted) return null;
  const printed = personPrinted.trim().toLowerCase().replace(/\s+/g, " ");
  for (const m of members) {
    if (!roles.includes(m.role)) continue;
    const name = (m.name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    if (name && (name === printed || firstName(name) === firstName(printed))) return m.id;
  }
  return null;
}

function sectionRecord(section: StatementSection, base: DocumentRecord, periodEnd: string | null, uploadId: string, members: { id: string; name: string; role: string }[], mapsVersion: string): DocumentRecord {
  const reading = extractSectionReading(section, statementPeriodOf(base.rawText ?? ""));
  const fields: Record<string, string> = { ...Object.fromEntries(Object.entries(reading.fields).map(([k, v]) => [k, String(v)])), ...hsaDepositFields(section) };
  if (periodEnd) fields["statement_as_of"] = periodEnd;
  if (section.kind === "529" && section.personName) fields["beneficiary_name"] = section.personName;
  const owner = section.kind === "529"
    ? nameMatch(section.personName, members, ["child"])
    : nameMatch(section.personName, members, ["self", "spouse"]);
  const sectionText = boundRawText(section.text);
  return {
    docType: section.docType,
    status: reading.status,
    confidence: reading.confidence,
    capturedOn: base.capturedOn ?? null,
    fields,
    ...(owner ? { ownerMemberId: owner } : {}),
    ...(base.ownerMemberId && section.kind === "529" && !owner ? { ownerMemberId: base.ownerMemberId } : {}),
    uploadId,
    accountId: section.accountId,
    rawText: sectionText,
    mapsVersion,
    extractorVersion: EXTRACTOR_VERSION,
    // Round 58: a fanned-out reading carries its section text's
    // fingerprint, so a later re-upload of the same statement
    // refreshes it in place.
    ...(fingerprintForSave(sectionText) ? { fingerprint: fingerprintForSave(sectionText) } : {}),
  };
}

/** Re-read every record that retained its text and sits behind the
 * current field maps OR behind the current extractor generation
 * (round 57: a parser change alone triggers the re-read, not only
 * a maps change). New coverage only ADDS: a re-read fills
 * fields the record does not carry yet and never overwrites a
 * confirmed value; a combined statement saved as one record fans
 * out into its account readings; a form saved under a generic type
 * before its type existed is re-typed. Records without retained
 * text are left exactly as they are - that is the honest boundary
 * of this pass, and the report says so. */
export function reprocessDocuments(
  docs: DocumentRecord[],
  members: { id: string; name: string; role: string }[],
  currentVersion: string,
): ReprocessResult {
  const notes: string[] = [];
  const out: DocumentRecord[] = [];
  docs.forEach((doc, idx) => {
    const extractorBehind = typeof doc.extractorVersion === "number" && doc.extractorVersion < EXTRACTOR_VERSION;
    if (!doc.rawText || (!versionBehind(doc.mapsVersion, currentVersion) && !extractorBehind)) {
      out.push(doc);
      return;
    }
    const text = doc.rawText;
    const label = `${doc.docType} captured ${doc.capturedOn ?? "on an unknown date"}`;

    // A tax form under a pre-round-55 type (or "other"): re-type it
    // and read its boxes.
    const form = parseSaForm(text);
    if (form && doc.docType !== form.kind) {
      const r = extractFields(form.fields, form.kind);
      const fields: Record<string, string> = { ...(doc.fields ?? {}), ...Object.fromEntries(Object.entries(r.fields).map(([k, v]) => [k, String(v)])) };
      if (form.taxYear) fields["tax_year"] = String(form.taxYear);
      if (form.accountId) fields["account_id"] = form.accountId;
      if (form.accountOwner) fields["account_owner"] = form.accountOwner;
      if (form.sourceDate) fields["source_date"] = form.sourceDate;
      const formBoxes: Record<string, string> = {};
      for (const [k, v] of Object.entries(fields)) if (k.startsWith("box_")) formBoxes[k] = v;
      out.push({ ...doc, docType: form.kind, fields, formBoxes, mapsVersion: currentVersion, extractorVersion: EXTRACTOR_VERSION, ...(doc.fingerprint ? {} : fingerprintForSave(text) ? { fingerprint: fingerprintForSave(text) } : {}) });
      notes.push(`Re-read ${label}: it is a ${form.kind === "hsa_5498_sa" ? "Form 5498-SA" : "Form 1099-SA"} (${form.taxYear ?? ""}) - saved under its own type now, with its boxes read.`);
      return;
    }

    // A combined statement saved as ONE record fans out. (A record
    // that already IS one account reading carries only its own
    // section's text, which segments to one section - it can never
    // re-fan itself.)
    const sections = segmentStatement(text);
    if (sections.length >= 2) {
      const period = statementPeriodOf(text);
      const uploadId = doc.uploadId ?? `up-reprocess-${idx}`;
      const recs = sections.map((s) => sectionRecord(s, doc, period?.endIso ?? null, uploadId, members, currentVersion));
      for (const r of recs) out.push(r);
      notes.push(`Re-read ${label}: it holds ${sections.length} accounts - split into ${sections.length} account readings, each with its own balance.`);
      const hsaRec = recs.find((d) => d.docType === "hsa_statement" && d.fields?.["per_payroll_contribution"] !== undefined);
      if (hsaRec) {
        notes.push(`Re-read ${label}: the HSA section's deposit detail shows a per-payroll contribution of $${Number(hsaRec.fields?.["per_payroll_contribution"]).toFixed(2)}, read from the statement's own deposit lines. It is on the HSA reading now.`);
      }
      return;
    }

    // Single reading: fill what the new coverage finds.
    const merged: Record<string, string> = { ...(doc.fields ?? {}) };
    const added: string[] = [];
    const fill = (fields: Record<string, string>) => {
      for (const [k, v] of Object.entries(fields)) {
        if (merged[k] === undefined && v !== "") { merged[k] = v; added.push(k); }
      }
    };
    // A fanned account reading retains only its own section's
    // text, and the account number that opens a section in
    // segmentation can sit OUTSIDE the retained span (on the real
    // combined statement the HSA span holds no Account # line -
    // the number appears earlier in the document flow). Such a
    // span segments to nothing on its own; the record still IS
    // one account's reading, so it is re-read as its own section.
    // The statement_as_of field is the tell: only a record fanned
    // out of a statement carries one (a screenshot reading does
    // not, and keeps the generic read below).
    let ownSection: StatementSection | null = null;
    if (sections.length === 1 && sections[0].docType === doc.docType) {
      ownSection = sections[0];
    } else if (sections.length === 0 && (doc.docType === "hsa_statement" || doc.docType === "529_statement")
      && typeof doc.fields?.["statement_as_of"] === "string" && doc.fields["statement_as_of"] !== "") {
      ownSection = {
        kind: doc.docType === "hsa_statement" ? "hsa" : "529",
        docType: doc.docType,
        accountId: doc.accountId ?? null,
        personName: null,
        text,
      };
    }
    if (ownSection) {
      const reading = extractSectionReading(ownSection, statementPeriodOf(text));
      fill(Object.fromEntries(Object.entries(reading.fields).map(([k, v]) => [k, String(v)])));
      fill(hsaDepositFields(ownSection));
      const period = statementPeriodOf(text);
      if (period && merged["statement_as_of"] === undefined) { merged["statement_as_of"] = period.endIso; added.push("statement_as_of"); }
    } else {
      let raw = textToRawFields(text);
      if (doc.docType === "hsa_statement") raw = [...parseHsaPageFields(text), ...raw];
      if (form) raw = [...form.fields, ...raw];
      try {
        const r = extractFields(raw, doc.docType);
        fill(Object.fromEntries(Object.entries(r.fields).map(([k, v]) => [k, String(v)])));
      } catch { /* a type the maps no longer carry: leave the record as it is */ }
    }
    let next: DocumentRecord = { ...doc, fields: merged, mapsVersion: currentVersion, extractorVersion: EXTRACTOR_VERSION, ...(doc.fingerprint ? {} : fingerprintForSave(text) ? { fingerprint: fingerprintForSave(text) } : {}) };
    if (doc.docType === "401k_statement") {
      const detail = parse401kDetail(text);
      if (detail) {
        const before = added.length;
        const extras = k401DetailFields(detail);
        const merged2 = { ...merged };
        for (const [k, v] of Object.entries(extras)) {
          if (merged2[k] === undefined) { merged2[k] = v; added.push(k); }
        }
        if (added.length > before) next = { ...next, fields: merged2 };
      }
    }
    out.push(next);
    if (added.length) notes.push(`Re-read ${label}: new facts found - ${added.join(", ")}.`);
    if (added.includes("per_payroll_contribution")) {
      notes.push(`Re-read ${label}: the statement's deposit detail shows a per-payroll HSA contribution of $${Number(merged["per_payroll_contribution"]).toFixed(2)}, read from the statement's own deposit lines. It is on the HSA card now, beside the period total it adds up to.`);
    }
  });
  // Round 59 (TRACE B): the dedupe sweep runs on EVERY load, not
  // only when a re-read fired - a duplicate pair already in stored
  // state heals here even at current versions.
  const swept = dedupeStoredDocuments(out);
  if (swept.merged > 0) {
    notes.push(`HomeTower found ${swept.merged} duplicate reading${swept.merged === 1 ? "" : "s"} of documents already on file and merged them - no document is counted twice.`);
  }
  return { docs: swept.docs, notes };
}
