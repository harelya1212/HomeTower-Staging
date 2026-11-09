// Round 58 acceptance: data governance - fingerprint dedupe on
// save (workstream 1) and the task lifecycles (workstream 2).
// The five-real-files double-ingestion acceptance test lives in
// round58-harness.ts; this suite pins the mechanisms with
// fixtures, in the shape of the earlier rounds.
//
// Copilot's conditions, pinned here:
//  - same document -> update/reconcile existing evidence -> no
//    duplicate financial facts (fingerprint first, semantic key
//    second, ONE save path: upsertDocument);
//  - the HSA task's unresolved amount is distributions minus
//    receipts matched, moves live, and the task is GONE at $0;
//  - the 529 task has the symmetric lifecycle against verified
//    education expenses, and its title names the UNRESOLVED
//    remainder in Copilot's round-55 wording.
// Run: node engine-tests/round58.ts
import type { DocumentRecord } from "../engine/intake.ts";
import { ocrMapsPack } from "../engine/packs.ts";
import {
  eduReconYearsFor, eduVerifiedKey, EXTRACTOR_VERSION, fingerprintForSave, fingerprintText,
  hsaReconciliation, normalizeTextForFingerprint, recordFingerprint, reconciliationTasks,
  reprocessDocuments, semanticKeyFor, upsertDocument,
} from "../src/reconcile.ts";

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
}
function ok(name: string, cond: boolean) {
  if (cond) pass++; else { fail++; console.log(`FAIL ${name}`); }
}

const VERSION = String(ocrMapsPack().version ?? "");
const members = [
  { id: "assaf", name: "Assaf Harel", role: "self" },
  { id: "shahar", name: "Shahar Harel", role: "child" },
  { id: "ella", name: "Ella Harel", role: "child" },
];
const children = members.filter((m) => m.role === "child").map((m) => ({ id: m.id, name: m.name }));

const LONG_TEXT = "Fidelity Investments statement period October 1 2026 to October 31 2026 account value and activity detail for the household accounts listed below in full.";

// ---------------------------------------------------------------------------
// 1. The fingerprint itself
// ---------------------------------------------------------------------------
eq("FP: deterministic", fingerprintText(LONG_TEXT), fingerprintText(LONG_TEXT));
eq("FP: case and spacing are not identity", fingerprintText("Hello   WORLD\nFoo"), fingerprintText("hello world foo"));
ok("FP: different text, different fingerprint", fingerprintText(LONG_TEXT) !== fingerprintText(LONG_TEXT + "x"));
eq("FP: normalization", normalizeTextForFingerprint("  A  B\tC \n"), "a b c");
eq("FP: a short text earns no stamp", fingerprintForSave("tiny"), null);
ok("FP: a real text earns a stamp", typeof fingerprintForSave(LONG_TEXT) === "string");
const preFp: DocumentRecord = { docType: "other", status: "parsed", capturedOn: "2026-11-01", rawText: LONG_TEXT, mapsVersion: "1.13" };
eq("FP: a pre-round-58 record recomputes its fingerprint from retained text", recordFingerprint(preFp), fingerprintText(LONG_TEXT));
eq("FP: no text, no stamp, no fingerprint", recordFingerprint({ docType: "other", status: "parsed" }), null);
eq("FP: a short retained text earns no fingerprint", recordFingerprint({ docType: "other", status: "parsed", rawText: "too short" }), null);

// ---------------------------------------------------------------------------
// 2. Semantic keys, one per kind
// ---------------------------------------------------------------------------
const slip = (name: string, end: string, gross: string): DocumentRecord => ({
  docType: "payslip", status: "parsed", capturedOn: "2026-11-09",
  fields: { employee_name: name, pay_period_end: end, gross_pay: gross },
});
eq("KEY: payslip is earner + period end", semanticKeyFor(slip("Assaf Harel", "10/31/2026", "9000")), "payslip|assaf harel|2026-10-31");
eq("KEY: payslip without an earner has no key", semanticKeyFor({ docType: "payslip", status: "parsed", fields: { pay_period_end: "10/31/2026" } }), null);
const k401 = (owner: string | null, asOf: string, bal: string): DocumentRecord => ({
  docType: "401k_statement", status: "parsed", capturedOn: "2026-11-09",
  ...(owner ? { ownerMemberId: owner } : {}),
  fields: { ending_balance: bal, statement_as_of: asOf },
});
eq("KEY: 401(k) is owner + period end", semanticKeyFor(k401("assaf", "2026-11-06", "271019.12")), "401k_statement|owner:assaf|2026-11-06");
eq("KEY: 401(k) without an owner has no semantic key (fingerprint only)", semanticKeyFor(k401(null, "2026-11-06", "271019.12")), null);
const sa = (type: string, year: string, acct: string): DocumentRecord => ({
  docType: type, status: "parsed", capturedOn: "2026-11-09",
  fields: { tax_year: year, account_id: acct },
});
eq("KEY: 1099-SA is type + tax year + account", semanticKeyFor(sa("hsa_1099_sa", "2025", "231-851100-001")), "hsa_1099_sa|yr:2025|acct:231851100001"); // round 59: account strings compare without punctuation (TRACE B)
ok("KEY: the two SA forms never share a key", semanticKeyFor(sa("hsa_1099_sa", "2025", "231-851100")) !== semanticKeyFor(sa("hsa_5498_sa", "2025", "231-851100")));
eq("KEY: an SA form without a tax year has no key", semanticKeyFor({ docType: "hsa_1099_sa", status: "parsed", fields: { account_id: "231-851100-001" } }), null);
const fanned = (acct: string, asOf: string): DocumentRecord => ({
  docType: "529_statement", status: "parsed", capturedOn: "2026-11-09", accountId: acct,
  fields: { statement_as_of: asOf, ending_balance: "4324.04" },
});
eq("KEY: a fanned section is account + period end", semanticKeyFor(fanned("618-579535", "2026-10-31")), "529_statement|acct:618-579535|2026-10-31");
eq("KEY: a fanned section without a period end has no key", semanticKeyFor({ ...fanned("618-579535", "2026-10-31"), fields: { ending_balance: "1" } }), null);
const ssa = (owner: string | null, date: string | null): DocumentRecord => ({
  docType: "ssa_statement", status: "parsed", capturedOn: "2026-11-09",
  ...(owner ? { ownerMemberId: owner } : {}),
  fields: { monthly_benefit_estimate: "2100", ...(date ? { source_date: date } : {}) },
});
eq("KEY: SSA is member + statement date when the reading carries one", semanticKeyFor(ssa("assaf", "2026-06-01")), "ssa_statement|owner:assaf|2026-06-01");
eq("KEY: SSA without a statement date is fingerprint only", semanticKeyFor(ssa("assaf", null)), null);

// ---------------------------------------------------------------------------
// 3. upsertDocument - the single save path
// ---------------------------------------------------------------------------
{
  // A genuinely new document appends.
  const r1 = upsertDocument([], k401("assaf", "2026-11-06", "271019.12"));
  eq("UP: a new document appends", [r1.docs.length, r1.index, r1.refreshed], [1, 0, false]);
  // The same statement re-read with a corrected figure (different
  // text, same owner + period) refreshes in place.
  const r2 = upsertDocument(r1.docs, k401("assaf", "2026-11-06", "271100.00"));
  eq("UP: a corrected reading of the same statement refreshes, no second record", [r2.docs.length, r2.refreshed], [1, true]);
  eq("UP: the refreshed facts are the new reading's", r2.docs[0]?.fields?.["ending_balance"], "271100.00");
  // A different period is a different document.
  const r3 = upsertDocument(r2.docs, k401("assaf", "2026-12-31", "280000"));
  eq("UP: a new period appends", [r3.docs.length, r3.refreshed], [2, false]);
  // A different owner's statement for the same period is a
  // different document.
  const r4 = upsertDocument(r3.docs, k401("yamit" as string, "2026-11-06", "50000"));
  eq("UP: another owner's statement appends", [r4.docs.length, r4.refreshed], [3, false]);
}
{
  // Fingerprint: the very same file read again (identical text)
  // refreshes even where the kind has no semantic key at all.
  const shot = (bal: string): DocumentRecord => ({
    docType: "hsa_statement", status: "parsed", capturedOn: "2026-11-09",
    fields: { ending_balance: bal }, rawText: LONG_TEXT, fingerprint: fingerprintForSave(LONG_TEXT),
  });
  const r1 = upsertDocument([], shot("13769.61"));
  const r2 = upsertDocument(r1.docs, shot("13769.61"));
  eq("UP: the same file again refreshes by fingerprint (no key needed)", [r2.docs.length, r2.refreshed], [1, true]);
  // A pre-round-58 record (no stamp, text retained) is matched by
  // the fingerprint it recomputes.
  const legacy: DocumentRecord = { docType: "hsa_statement", status: "parsed", capturedOn: "2026-11-02", fields: { ending_balance: "13000" }, rawText: LONG_TEXT, mapsVersion: "1.13" };
  const r3 = upsertDocument([legacy], shot("13769.61"));
  eq("UP: a legacy record dedupes by its recomputed fingerprint", [r3.docs.length, r3.refreshed, r3.docs[0]?.fields?.["ending_balance"]], [1, true, "13769.61"]);
  // A different document never fingerprint-matches.
  const other: DocumentRecord = { ...shot("1"), rawText: LONG_TEXT + " A second page with more text follows here.", fingerprint: fingerprintForSave(LONG_TEXT + " A second page with more text follows here.") };
  const r4 = upsertDocument(r1.docs, other);
  eq("UP: different text appends", [r4.docs.length, r4.refreshed], [2, false]);
}
{
  // Payslips through the same path (the round-55/56 replace rule).
  const r1 = upsertDocument([], slip("Assaf Harel", "10/31/2026", "9000"));
  const r2 = upsertDocument(r1.docs, slip("Assaf Harel", "10/31/2026", "9100"));
  eq("UP: a repeat payslip replaces (same earner + period)", [r2.docs.length, r2.refreshed, r2.docs[0]?.fields?.["gross_pay"]], [1, true, "9100"]);
  const r3 = upsertDocument(r2.docs, slip("Yamit Harel", "10/31/2026", "4000"));
  eq("UP: another earner's slip for the same period appends", r3.docs.length, 2);
}
{
  // SA forms: re-uploading the same 1099-SA refreshes; the 5498-SA
  // for the same account and year is a different document.
  const form = (type: string, acct: string, box1: string): DocumentRecord => ({
    docType: type, status: "parsed", capturedOn: "2026-11-09",
    fields: { tax_year: "2025", account_id: acct, box_1_gross_distribution: box1 },
  });
  const r1 = upsertDocument([], form("hsa_1099_sa", "231-851100-001", "7743.99"));
  const r2 = upsertDocument(r1.docs, form("hsa_1099_sa", "231-851100-001", "7743.99"));
  eq("UP: the same 1099-SA again refreshes", [r2.docs.length, r2.refreshed], [1, true]);
  const r3 = upsertDocument(r2.docs, form("hsa_5498_sa", "231-851100", ""));
  eq("UP: the 5498-SA is its own document", [r3.docs.length, r3.refreshed], [2, false]);
  const r4 = upsertDocument(r3.docs, form("hsa_1099_sa", "999-999999-001", "100"));
  eq("UP: a different account's 1099-SA appends", r4.docs.length, 3);
}
{
  // A refresh keeps the earlier owner assignment when the new
  // reading carries none (a re-upload never un-assigns).
  const owned: DocumentRecord = { docType: "hsa_statement", status: "parsed", capturedOn: "2026-11-02", ownerMemberId: "assaf", fields: { ending_balance: "1", statement_as_of: "2026-10-31" }, rawText: LONG_TEXT, mapsVersion: "1.13" };
  const reRead: DocumentRecord = { docType: "hsa_statement", status: "parsed", capturedOn: "2026-11-09", fields: { ending_balance: "2" }, rawText: LONG_TEXT, fingerprint: fingerprintForSave(LONG_TEXT) };
  const r = upsertDocument([owned], reRead);
  eq("UP: a refresh preserves the owner assignment", [r.refreshed, r.docs[0]?.ownerMemberId], [true, "assaf"]);
}
{
  // Register discipline: five saves of one document leave ONE
  // entry, and the reprocess banner accounting never sees the
  // refreshes - a current record passes through untouched.
  let docs: DocumentRecord[] = [];
  for (let i = 0; i < 5; i++) docs = upsertDocument(docs, k401("assaf", "2026-11-06", "271019.12")).docs;
  eq("UP: five saves of one statement leave one register entry", docs.length, 1);
  const stamped: DocumentRecord = { ...k401("assaf", "2026-11-06", "271019.12"), rawText: LONG_TEXT, mapsVersion: VERSION, extractorVersion: EXTRACTOR_VERSION, fingerprint: fingerprintForSave(LONG_TEXT) };
  const rp = reprocessDocuments([stamped], members, VERSION);
  ok("UP: reprocess leaves a refreshed current record untouched (no banner noise)", rp.docs[0] === stamped && rp.notes.length === 0);
}

// ---------------------------------------------------------------------------
// 4. HSA task lifecycle (verify + pin the round-55 behavior)
// ---------------------------------------------------------------------------
const hsaStmt: DocumentRecord = {
  docType: "hsa_statement", status: "parsed", capturedOn: "2026-11-09", accountId: "231-851100",
  fields: { ending_balance: "13808.57", contributions_ytd: "3621.33", distributions_ytd: "5309.46", statement_as_of: "2026-10-31" },
};
{
  const t0 = reconciliationTasks([hsaStmt], children, {});
  eq("HSA-L: the task appears with nothing matched", t0.filter((t) => t.key === "reconhsa-2026").length, 1);
  const recMid = hsaReconciliation([hsaStmt], { "2026": 2000 });
  eq("HSA-L: a partial match shrinks the unresolved remainder live", [recMid[0]?.matched, recMid[0]?.unverified], [2000, 3309.46]);
  const tMid = reconciliationTasks([hsaStmt], children, { "2026": 2000 });
  ok("HSA-L: the task detail carries the shrunken remainder", tMid[0]?.detail.includes("Still unverified $3,309") ?? false);
  const recFull = hsaReconciliation([hsaStmt], { "2026": 5309.46 });
  eq("HSA-L: a full match zeroes the remainder", recFull[0]?.unverified, 0);
  const tFull = reconciliationTasks([hsaStmt], children, { "2026": 5309.46 });
  eq("HSA-L: at $0 unresolved the task is GONE", tFull.filter((t) => t.key === "reconhsa-2026").length, 0);
  const tOver = reconciliationTasks([hsaStmt], children, { "2026": 99999 });
  eq("HSA-L: an over-match never resurrects or negates the task", tOver.filter((t) => t.key === "reconhsa-2026").length, 0);
}

// ---------------------------------------------------------------------------
// 5. 529 task lifecycle (the symmetric build)
// ---------------------------------------------------------------------------
const doc529 = (childId: string, acct: string, dist: string): DocumentRecord => ({
  docType: "529_statement", status: "parsed", capturedOn: "2026-11-09", ownerMemberId: childId, accountId: acct,
  fields: { ending_balance: "4324.04", distributions_ytd: dist, statement_as_of: "2026-10-31" },
});
const shahar529 = doc529("shahar", "618-579535", "14733.34");
const ella529 = doc529("ella", "618-579537", "2000");
{
  const years = eduReconYearsFor([shahar529], children[0], {});
  eq("529-L: one recon year from the statement", [years.length, years[0]?.distributions, years[0]?.verified, years[0]?.unverified], [1, 14733.34, 0, 14733.34]);
  const t0 = reconciliationTasks([shahar529], children, {}, {});
  eq("529-L: with nothing verified the task names the full figure (round-55 wording)", t0[0]?.title,
    "$14,733 of 2026 529 distributions detected. Qualified education expense evidence needs reconciliation.");
  const partial = { [eduVerifiedKey("shahar", 2026)]: 4733.34 };
  const yearsMid = eduReconYearsFor([shahar529], children[0], partial);
  eq("529-L: verified evidence shrinks the remainder", yearsMid[0]?.unverified, 10000);
  const tMid = reconciliationTasks([shahar529], children, {}, partial);
  eq("529-L: the task title names the UNRESOLVED remainder", tMid[0]?.title,
    "$10,000 of 2026 529 distributions detected. Qualified education expense evidence needs reconciliation.");
  ok("529-L: the detail carries all three figures", (tMid[0]?.detail.includes("529 distributions $14,733") && tMid[0]?.detail.includes("Education expenses verified $4,733") && tMid[0]?.detail.includes("Still unverified $10,000")) ?? false);
  ok("529-L: unverified never reads as non-qualified", tMid[0]?.detail.includes("does not mean non-qualified") ?? false);
  const full = { [eduVerifiedKey("shahar", 2026)]: 14733.34 };
  eq("529-L: at $0 unresolved the task is GONE", reconciliationTasks([shahar529], children, {}, full).filter((t) => t.key.startsWith("recon529-")).length, 0);
  // Per-child isolation: verifying Shahar's expenses never touches
  // Ella's task, and vice versa.
  const both = reconciliationTasks([shahar529, ella529], children, {}, full);
  eq("529-L: a sibling's task is untouched by Shahar's verification", both.map((t) => t.key), ["recon529-ella-2026"]);
  eq("529-L: Ella's task names her own remainder", both[0]?.title,
    "$2,000 of 2026 529 distributions detected. Qualified education expense evidence needs reconciliation.");
  // The lifecycle is derived from facts + the persisted verified
  // amounts, so a JSON round-trip (a reload) changes nothing.
  const persisted = JSON.parse(JSON.stringify({ docs: [shahar529], verified: partial })) as { docs: DocumentRecord[]; verified: Record<string, number> };
  eq("529-L: the lifecycle survives a reload (persisted state round-trip)",
    reconciliationTasks(persisted.docs, children, {}, persisted.verified).map((t) => t.title),
    reconciliationTasks([shahar529], children, {}, partial).map((t) => t.title));
}

console.log(`round58: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
