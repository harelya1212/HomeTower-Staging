// Source-agnostic document extraction - TS port of extract.py.
// Confidence gate: 'parsed' at >= 0.80, 'pending_verify' below it.
import { ocrMapsPack, type Pack } from "./packs.ts";

export const CONFIDENCE_GATE = 0.8;

export interface RawField { key: string; value: string; confidence: number }

export interface ExtractionResult {
  documentType: string;
  fields: Record<string, number | string>;
  fieldConfidence: Record<string, number>;
  confidence: number;
  status: "parsed" | "pending_verify";
}

function normalizeKey(raw: string): string {
  return raw.toLowerCase().trim().replaceAll(":", "").replaceAll("*", "");
}

function extractAmount(valueStr: string): number | null {
  const cleaned = valueStr.trim().replace(/[$,\s]/g, "").replace("(", "-").replace(")", "");
  const n = Number(cleaned);
  return cleaned !== "" && !Number.isNaN(n) ? n : null;
}

export function extractFields(rawFields: RawField[], documentType: string, pack: Pack = ocrMapsPack()): ExtractionResult {
  const fieldMap: Record<string, string> | undefined = pack.maps[documentType];
  if (!fieldMap) throw new Error(`Unknown document type: ${documentType}`);
  const result: ExtractionResult = { documentType, fields: {}, fieldConfidence: {}, confidence: 0, status: "pending_verify" };
  const confidences: number[] = [];
  for (const raw of rawFields) {
    const normalized = normalizeKey(raw.key);
    let fieldName: string | undefined = fieldMap[normalized];
    if (!fieldName) {
      for (const [mapKey, mapField] of Object.entries(fieldMap)) {
        // Fuzzy containment only when the shorter side is a
        // substantial phrase (mirror of extract.py).
        if (Math.min(mapKey.length, normalized.length) >= 12 && (normalized.includes(mapKey) || mapKey.includes(normalized))) { fieldName = mapField; break; }
      }
    }
    if (!fieldName) continue;
    // Pure punctuation is form furniture, never a value.
    if (!/[A-Za-z0-9]/.test(raw.value)) continue;
    const amount = extractAmount(raw.value);
    // Household documents do not carry nine-figure amounts.
    if (amount !== null && Math.abs(amount) >= 100_000_000) continue;
    const existing = result.fields[fieldName];
    // First PARSED amount wins (mirror of extract.py): an early clean
    // figure is never overwritten by later prose; prose is replaced as
    // soon as a real amount for the field appears. One exception: a
    // parsed ZERO is provisional - state forms print furniture like
    // "Arizona Adjusted Gross Income ~ 00" ahead of the real federal
    // figure, so a later non-zero amount replaces a zero (real packet
    // rehearsal, 2026-11-07).
    if (amount !== null) {
      if (existing === undefined || typeof existing === "string" || (existing === 0 && amount !== 0)) {
        result.fields[fieldName] = amount;
        result.fieldConfidence[fieldName] = raw.confidence;
        confidences.push(raw.confidence);
      }
    } else if (existing === undefined) {
      result.fields[fieldName] = raw.value.trim();
      result.fieldConfidence[fieldName] = raw.confidence;
      confidences.push(raw.confidence);
    }
  }
  result.confidence = confidences.length ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 1000) / 1000 : 0;
  result.status = result.confidence >= CONFIDENCE_GATE ? "parsed" : "pending_verify";
  return result;
}
