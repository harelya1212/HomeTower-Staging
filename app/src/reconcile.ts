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
  return resolveFields(docs.filter((d) => d.docType === "hsa_statement"));
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
  const stmts = docs.filter((d) => d.docType === "hsa_statement");
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
  return resolveFields(docs.filter((d) => d.docType === "529_statement" && d.ownerMemberId === childId));
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
  for (const d of docs) {
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

/** The reconciliation tasks (derived, so one per child/HSA per tax
 * year by construction). Wording is Copilot's, verbatim in shape:
 * the 529 task names the rounded distributions and the tax year;
 * the HSA task names the exact distributions and carries the
 * receipts shape. Unverified never reads as taxable. */
export function reconciliationTasks(
  docs: DocumentRecord[],
  children: { id: string; name: string }[],
  matchedByYear: Record<string, number>,
): ReconTask[] {
  const tasks: ReconTask[] = [];
  for (const child of children) {
    let owned = docs.filter((d) => d.docType === "529_statement" && d.ownerMemberId === child.id);
    if (!owned.length && firstName(child.name)) {
      owned = docs.filter((d) => d.docType === "529_statement" && !d.ownerMemberId
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
    for (const [year, v] of [...byYear.entries()].sort((a, b) => b[0] - a[0])) {
      tasks.push({
        key: `recon529-${child.id}-${year}`,
        icon: "🎓",
        title: `${money0(v.dist)} of ${year} 529 distributions detected. Qualified education expense evidence needs reconciliation.`,
        detail: `Read from ${child.name || "your child"}'s 529 statement (${dateLabel(v.asOf)}). Bursar ledgers, tuition receipts and scholarship records are the evidence - add them in Documents.`,
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
    rawText: boundRawText(section.text),
    mapsVersion,
    extractorVersion: EXTRACTOR_VERSION,
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
      out.push({ ...doc, docType: form.kind, fields, formBoxes, mapsVersion: currentVersion, extractorVersion: EXTRACTOR_VERSION });
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
    let next: DocumentRecord = { ...doc, fields: merged, mapsVersion: currentVersion, extractorVersion: EXTRACTOR_VERSION };
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
  return { docs: out, notes };
}
