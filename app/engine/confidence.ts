// Prediction confidence - TS port of confidence.py. One personal
// formula per household; see the Python module for the full spec.
import { documentFreshness } from "./freshness.ts";
import type { DocumentRecord, HouseholdIntake } from "./intake.ts";

const DOC_WEIGHTS: Record<string, number> = { payslip: 10, prior_return: 8, w2: 5, "401k_statement": 4, hsa_statement: 4, "529_statement": 2, brokerage_statement: 2 };
const FRESHNESS_FACTOR: Record<string, number> = { fresh: 1.0, aging: 0.6, stale: 0.2, unknown: 0.5 };

export interface DocumentIndicator { docType: string; freshnessStatus: string; counts: "fully" | "partially" | "barely"; note: string }

export interface ConfidenceReport {
  score: number; band: string;
  completeness: number; freshness: number; extraction: number; coverage: number; calibration: number;
  reasons: string[]; calibrationMissing: boolean; perDocument: DocumentIndicator[];
}

function band(score: number): string {
  return score >= 80 ? "High" : score >= 55 ? "Moderate" : "Low";
}

export function documentIndicator(doc: DocumentRecord, today: string): DocumentIndicator {
  const f = documentFreshness(doc, today);
  const counts = doc.status !== "parsed" ? "barely" : f.status === "fresh" ? "fully" : f.status === "aging" ? "partially" : "barely";
  return { docType: doc.docType, freshnessStatus: f.status, counts, note: f.message };
}

export function predictionConfidence(h: HouseholdIntake, today: string): ConfidenceReport {
  const parsed = h.documents.filter((d) => d.status === "parsed");
  const presentTypes = new Set(parsed.map((d) => d.docType));

  const completeness = Object.entries(DOC_WEIGHTS).reduce((sum, [t, w]) => sum + (presentTypes.has(t) ? w : 0), 0);
  let freshness = 0;
  let extraction = 0;
  if (parsed.length) {
    freshness = (parsed.reduce((s, d) => s + FRESHNESS_FACTOR[documentFreshness(d, today).status], 0) / parsed.length) * 25;
    extraction = (parsed.reduce((s, d) => s + (d.confidence ?? 0), 0) / parsed.length) * 10;
  }

  let coverage = 10;
  if (h.hasRsu && !presentTypes.has("brokerage_statement")) coverage -= 4;
  if (h.hasEspp && !presentTypes.has("brokerage_statement")) coverage -= 3;
  if (h.hasForeignAccountsOrIncome && !presentTypes.has("brokerage_statement") && !presentTypes.has("other")) coverage -= 3;
  coverage = Math.max(0, coverage);

  const cal = h.calibration ?? null;
  let calibration = 0;
  if (cal) {
    if (cal.federalFiled) calibration += cal.outcomeVerified && cal.actualFederalRefundOwe != null ? 14 : cal.actualFederalRefundOwe != null ? 9 : 4;
    if (cal.stateFiled) calibration += cal.outcomeVerified && cal.actualStateRefundOwe != null ? 6 : cal.actualStateRefundOwe != null ? 4 : 2;
  }
  const calibrationMissing = !(cal && cal.outcomeVerified && cal.actualFederalRefundOwe != null);

  const score = Math.round(completeness + freshness + extraction + coverage + calibration);

  const reasons: string[] = [];
  for (const d of parsed) {
    const f = documentFreshness(d, today);
    if (f.status === "stale") reasons.push(`${d.docType} is stale - upload a current one`);
    else if (f.status === "aging") reasons.push(`${d.docType} is about to expire`);
  }
  if (!presentTypes.has("payslip")) reasons.push("no current payslip on file");
  if (calibrationMissing) reasons.push("last year's filed return is not verified against the actual IRS/state outcome yet - add it to calibrate");
  if (coverage < 10) reasons.push("some holdings (RSU/ESPP/foreign) have no matching statement on file");

  return {
    score, band: band(score), completeness,
    freshness: Math.round(freshness * 100) / 100,
    extraction: Math.round(extraction * 100) / 100,
    coverage, calibration,
    reasons: reasons.slice(0, 4),
    calibrationMissing,
    perDocument: h.documents.map((d) => documentIndicator(d, today)),
  };
}
