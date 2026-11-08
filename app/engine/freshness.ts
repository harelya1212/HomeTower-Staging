// Document freshness - TS port of freshness.py. See the Python module
// for the rules (fresh / aging / stale windows per document type).
import { daysBetween } from "./packs.ts";
import type { DocumentRecord } from "./intake.ts";

export const FRESHNESS_WINDOW_DAYS: Record<string, number> = {
  payslip: 35, brokerage_statement: 40, "401k_statement": 100, hsa_statement: 100,
  "529_statement": 100, w2: 400, "1099b": 400, "1098t": 400, "1099q": 400,
  prior_return: 400, pension_statement: 400, other: 180,
};
export const AGING_WARNING_DAYS = 7;

export interface FreshnessFinding {
  docType: string;
  status: "fresh" | "aging" | "stale" | "unknown";
  ageDays: number | null;
  windowDays: number;
  message: string;
}

export function documentFreshness(doc: DocumentRecord, today: string): FreshnessFinding {
  const window = FRESHNESS_WINDOW_DAYS[doc.docType] ?? 180;
  if (!doc.capturedOn) {
    return { docType: doc.docType, status: "unknown", ageDays: null, windowDays: window, message: `${doc.docType}: no capture date recorded - freshness unknown.` };
  }
  const age = daysBetween(doc.capturedOn, today);
  if (age > window) return { docType: doc.docType, status: "stale", ageDays: age, windowDays: window, message: `${doc.docType} is ${age} days old (window ${window}) - update it.` };
  if (age >= window - AGING_WARNING_DAYS) return { docType: doc.docType, status: "aging", ageDays: age, windowDays: window, message: `${doc.docType} expires in ${window - age} days - a newer one is due.` };
  return { docType: doc.docType, status: "fresh", ageDays: age, windowDays: window, message: `${doc.docType} is fresh (${age} days old).` };
}

const ORDER: Record<string, number> = { stale: 0, aging: 1, unknown: 2, fresh: 3 };

export function householdFreshness(documents: DocumentRecord[], today: string): FreshnessFinding[] {
  return documents.map((d) => documentFreshness(d, today)).sort((a, b) => ORDER[a.status] - ORDER[b.status]);
}

export function reminderCandidates(documents: DocumentRecord[], today: string): FreshnessFinding[] {
  return householdFreshness(documents, today).filter((f) => f.status === "stale" || f.status === "aging");
}
