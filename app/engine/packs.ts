// Content-pack access. Tax data is content with a version, never code.
// The JSON files in ../packs are the SAME files the Python reference
// engine reads (engine/content) - one source of truth, two runtimes.
import federal2026 from "../packs/federal-2026.json" with { type: "json" };
import states2026 from "../packs/states-2026.json" with { type: "json" };
import ocrFieldMaps from "../packs/ocr-field-maps.json" with { type: "json" };
import treatyUsIl from "../packs/treaty-us-il.json" with { type: "json" };

/** The engine generation (ROUND 62, R62-6). Every forecast
 * snapshot stamps this version alongside the content-pack
 * versions, so a figure can always be tied to the exact engine
 * that produced it. Bump on any change to forecast semantics. */
export const ENGINE_VERSION = "62.1.0";

export type Pack = Record<string, any>;

export function federalPack(): Pack {
  return federal2026 as Pack;
}
export function statesPack(): Pack {
  return states2026 as Pack;
}
export function ocrMapsPack(): Pack {
  return ocrFieldMaps as Pack;
}
export function treatyPack(): Pack {
  return treatyUsIl as Pack;
}

export type Bracket = [number, number, number];

export function brackets(raw: [number, number | null, number][]): Bracket[] {
  return raw.map(([low, high, rate]) => [low, high === null ? Infinity : high, rate]);
}

/** Round to 2 decimals (money). Python's round() is banker's rounding;
 * the shared golden vectors tolerate 0.011, which absorbs the difference
 * at exact half-cent boundaries. */
export function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}
export function round4(x: number): number {
  return Math.round((x + Number.EPSILON) * 10000) / 10000;
}

/** Whole days from ISO date a to ISO date b (b - a), UTC-safe. */
export function daysBetween(a: string, b: string): number {
  const ms = Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z");
  return Math.round(ms / 86400000);
}
export function addDays(iso: string, days: number): string {
  const d = new Date(Date.parse(iso + "T00:00:00Z") + days * 86400000);
  return d.toISOString().slice(0, 10);
}
