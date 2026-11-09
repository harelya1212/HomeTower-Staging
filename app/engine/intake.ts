// Household intake model, validation, derived accuracy level - TS port
// of intake.py. The level is DERIVED from what was actually provided and
// caps at X++ (X+++ is filing-time only).
export const FILING_STATUSES = new Set(["single", "married_filing_jointly", "married_filing_separately", "head_of_household"]);
export const MEMBER_ROLES = new Set(["adult", "dependent", "student"]);
export const PAY_FREQUENCIES = new Set(["weekly", "biweekly", "semimonthly", "monthly"]);
export const DOCUMENT_TYPES = new Set(["w2", "payslip", "hsa_statement", "401k_statement", "1099b", "1098t", "1099q", "prior_return", "529_statement", "brokerage_statement", "pension_statement", "bank_statement", "card_statement", "ssa_statement", "hsa_1099_sa", "hsa_5498_sa", "other"]);
export const DOCUMENT_STATUSES = new Set(["parsed", "pending_verify", "rejected"]);

export interface Member { name: string; role: string; dateOfBirth?: string | null; payFrequency?: string | null }
export interface CalibrationRecord {
  taxYear: number;
  federalFiled?: boolean;
  stateFiled?: boolean;
  actualFederalRefundOwe?: number | null; // + refund, - owed
  actualStateRefundOwe?: number | null;
  outcomeVerified?: boolean; // checked against the IRS/state outcome
}
export interface Holding { ticker: string; name: string; quantity: number; pricePaid: number; lastPrice: number }
export interface DocumentRecord {
  docType: string; status: string; confidence?: number; capturedOn?: string | null;
  ownerMemberId?: string | null; fields?: Record<string, string>; holdings?: Holding[];
  spendingSummary?: SpendingSummary | null;
  /** Round 55: fan-out linkage - every account reading cut from one
   * uploaded document shares its uploadId; accountId is the account
   * number the source printed (never a portfolio total). */
  uploadId?: string | null;
  accountId?: string | null;
  /** Round 55: the extracted text of the source (bounded), retained
   * so improved parsers can re-read the document without a
   * re-upload (workstream G). Absent on records saved before round
   * 55 - those cannot be reprocessed, only re-uploaded. */
  rawText?: string | null;
  /** Round 55: the ocr-field-maps version this record was extracted
   * with; the reprocess pass re-reads records behind the current
   * version when they carry rawText. */
  mapsVersion?: string | null;
  /** Round 57: the extractor/parser generation that read this
   * record (EXTRACTOR_VERSION in src/reconcile.ts). The reprocess
   * pass ALSO re-reads a record whose extractor stamp is behind,
   * even when its maps version is current - a parser improvement
   * alone (like the HSA deposit detail) reaches saved records
   * without a re-upload. Absent on records saved before round 57;
   * those are governed by their mapsVersion alone. */
  extractorVersion?: number | null;
  /** Round 55: structured tax-form boxes (hsa_1099_sa / hsa_5498_sa)
   * - the numbered boxes exactly as the form printed them. */
  formBoxes?: Record<string, string> | null;
  /** Round 58: the content fingerprint of the extracted text this
   * reading came from (FNV-1a over the normalized text - see
   * fingerprintText in src/reconcile.ts). Stamped at save and at
   * reprocess; a re-upload of the same document carries the same
   * fingerprint and refreshes this record in place instead of
   * stacking a duplicate (upsertDocument in src/reconcile.ts).
   * Absent on records saved before round 58 - for those the
   * fingerprint is recomputed from the retained rawText whenever
   * one is needed, so they dedupe too. */
  fingerprint?: string | null;
}
/** Round 48: what a bank/card statement CSV proved about household
 * spending - months of evidence and annualized outflows per
 * Retirement Lifestyle category key (see src/goals.ts). Evidence
 * only: it prefills the Lifestyle page, it never overwrites an
 * amount the user entered. PDF statements carry no summary - they
 * count as one month of coverage each. */
export interface SpendingSummary { months: number; byCategory: Record<string, number> }
export interface HouseholdIntake {
  name: string; state: string; filingStatus: string; members: Member[];
  refundTargetLow?: number | null; refundTargetHigh?: number | null;
  documents: DocumentRecord[];
  hasRsu?: boolean; hasEspp?: boolean; hasForeignAccountsOrIncome?: boolean;
  ytdPayrollKnown?: boolean; capitalLossCarryforwardKnown?: boolean;
  calibration?: CalibrationRecord | null;
}

export function validateIntake(h: HouseholdIntake): string[] {
  const errors: string[] = [];
  if (!h.name.trim()) errors.push("household name is required");
  if (!(h.state.length === 2 && /^[A-Z]+$/.test(h.state))) errors.push("state must be a 2-letter uppercase code");
  if (!FILING_STATUSES.has(h.filingStatus)) errors.push(`filing_status must be one of ${[...FILING_STATUSES].sort().join(", ")}`);
  if (!h.members.length) errors.push("at least one member is required");
  for (const m of h.members) {
    if (!MEMBER_ROLES.has(m.role)) errors.push(`member ${m.name}: role must be one of ${[...MEMBER_ROLES].sort().join(", ")}`);
    if (m.payFrequency != null && !PAY_FREQUENCIES.has(m.payFrequency)) errors.push(`member ${m.name}: unknown pay_frequency ${m.payFrequency}`);
  }
  const low = h.refundTargetLow ?? null;
  const high = h.refundTargetHigh ?? null;
  if ((low === null) !== (high === null)) errors.push("refund target needs both low and high");
  if (low !== null && high !== null && low > high) errors.push("refund target low must be <= high");
  for (const d of h.documents) {
    if (!DOCUMENT_TYPES.has(d.docType)) errors.push(`unknown document type ${d.docType}`);
    if (!DOCUMENT_STATUSES.has(d.status)) errors.push(`document ${d.docType}: unknown status ${d.status}`);
  }
  return errors;
}

function parsed(h: HouseholdIntake, docType: string): boolean {
  return h.documents.some((d) => d.docType === docType && d.status === "parsed");
}

export function accuracyLevel(h: HouseholdIntake): string {
  if (validateIntake(h).length) return "X";
  if ((h.refundTargetLow ?? null) === null || !parsed(h, "payslip")) return "X";
  if (parsed(h, "prior_return") && h.ytdPayrollKnown && h.capitalLossCarryforwardKnown) return "X++";
  return "X+";
}
