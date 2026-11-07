// Document auto-classification - TS port of classify.py.
// The user uploads WITHOUT naming the type; the app proposes one and
// the user confirms or overrides before anything is saved. The same
// check verifies a type the user did name. Deterministic scoring:
// 3 x matched field-map labels + 1 per distinctive keyword.
import type { RawField } from "./extract.ts";
import { ocrMapsPack, type Pack } from "./packs.ts";

const KEYWORDS: Record<string, string[]> = {
  w2: ["w-2", "wage and tax statement", "wages tips", "social security wages", "medicare wages"],
  payslip: ["gross pay", "net pay", "pay period", "pay date", "year to date", "earnings statement"],
  "1099b": ["1099-b", "proceeds", "cost or other basis", "date acquired", "date sold"],
  "1098t": ["1098-t", "qualified tuition", "tuition and fees", "scholarships or grants"],
  "1099q": ["1099-q", "gross distribution", "qualified education expenses"],
  hsa_statement: ["health savings account", "hsa"],
  "401k_statement": ["401(k)", "401k", "vested balance", "retirement savings plan"],
  "529_statement": ["529 plan", "college savings plan", "education account"],
  brokerage_statement: ["brokerage", "securities account", "portfolio value", "holdings"],
  prior_return: ["1040", "adjusted gross income", "taxable income", "internal revenue service", "u.s. individual income tax return"],
};

export interface Classification {
  docType: string;
  level: "strong" | "likely" | "unknown";
  score: number;
  signals: string[];
  runnerUp: string | null;
  runnerUpScore: number;
}

function normalizeKey(raw: string): string {
  return raw.toLowerCase().trim().replaceAll(":", "").replaceAll("*", "");
}

export function classifyDocument(rawFields: RawField[], text = "", pack: Pack = ocrMapsPack()): Classification {
  const maps: Record<string, Record<string, string>> = pack.maps;
  const keys = rawFields.map((f) => normalizeKey(f.key));
  const haystack = keys.join(" ") + " " + text.toLowerCase();
  const scored: { docType: string; score: number; signals: string[] }[] = [];
  for (const [docType, fieldMap] of Object.entries(maps)) {
    if (docType === "other") continue;
    const matched = keys.filter((k) => k in fieldMap);
    const kwHits = (KEYWORDS[docType] ?? []).filter((kw) => haystack.includes(kw));
    scored.push({ docType, score: 3 * matched.length + kwHits.length, signals: [...matched, ...kwHits] });
  }
  scored.sort((a, b) => b.score - a.score || a.docType.localeCompare(b.docType));
  const best = scored[0];
  const runner = scored[1];
  if (best.score < 3) {
    return { docType: "other", level: "unknown", score: best.score, signals: [], runnerUp: runner?.docType ?? null, runnerUpScore: runner?.score ?? 0 };
  }
  return {
    docType: best.docType,
    level: best.score >= 6 ? "strong" : "likely",
    score: best.score,
    signals: best.signals.slice(0, 5),
    runnerUp: runner?.docType ?? null,
    runnerUpScore: runner?.score ?? 0,
  };
}
