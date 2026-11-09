// Household intake model, validation, derived accuracy level - TS port
// of intake.py. The level is DERIVED from what was actually provided and
// caps at X++ (X+++ is filing-time only).
export const FILING_STATUSES = new Set(["single", "married_filing_jointly", "married_filing_separately", "head_of_household"]);
export const MEMBER_ROLES = new Set(["adult", "dependent", "student"]);
export const PAY_FREQUENCIES = new Set(["weekly", "biweekly", "semimonthly", "monthly"]);
export const DOCUMENT_TYPES = new Set(["w2", "payslip", "hsa_statement", "401k_statement", "1099b", "1098t", "1099q", "prior_return", "529_statement", "brokerage_statement", "pension_statement", "bank_statement", "card_statement", "other"]);
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
export interface DocumentRecord { docType: string; status: string; confidence?: number; capturedOn?: string | null; fields?: Record<string, string>; holdings?: Holding[]; spendingSummary?: SpendingSummary | null }
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
