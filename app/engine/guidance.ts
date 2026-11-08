// Guidance layer - TS port of guidance.py (SPEC45 sec. 16, 17, 20, 39+42).
// The profile determines document requests; the payroll shortcut allows
// provisional no-change confirmations; the annual cycle names the current
// planning phase; and nextAction returns exactly ONE action in the
// section 42 format.
import { documentFreshness } from "./freshness.ts";
import type { HouseholdIntake } from "./intake.ts";

export const MAX_PROVISIONAL_CYCLES = 2;

export interface ProfileExtras {
  hasHsa?: boolean;
  hasBrokerage?: boolean;
  hasRental?: boolean;
  hasCollegeStudent?: boolean;
}

export interface DocRequest {
  key: string;
  category: string;
  docType: string;
  label: string;
  detail: string;
  status: "satisfied" | "stale" | "missing";
}

function docStatus(h: HouseholdIntake, docType: string, today: string): "satisfied" | "stale" | "missing" {
  const parsed = h.documents.filter((d) => d.docType === docType && d.status === "parsed");
  if (!parsed.length) return "missing";
  const dated = parsed.filter((d) => d.capturedOn);
  if (!dated.length) return "satisfied";
  const latest = dated.reduce((a, b) => ((a.capturedOn as string) >= (b.capturedOn as string) ? a : b));
  return documentFreshness(latest, today).status === "stale" ? "stale" : "satisfied";
}

function calibrationComplete(h: HouseholdIntake): boolean {
  const c = h.calibration;
  return !!(c && c.federalFiled && c.actualFederalRefundOwe != null && c.outcomeVerified);
}

export function documentRequests(h: HouseholdIntake, extras: ProfileExtras, today: string): DocRequest[] {
  const reqs: DocRequest[] = [];
  const add = (key: string, category: string, docType: string, label: string, detail: string, status?: DocRequest["status"]) => {
    reqs.push({ key, category, docType, label, detail, status: status ?? docStatus(h, docType, today) });
  };

  add("prior_return", "calibration", "prior_return", "Last year's filed tax return",
    "The federal and state return exactly as filed - the calibration anchor for every forecast.");
  add("calibration_outcome", "calibration", "prior_return", "Last year's actual outcome",
    "The real refund you received or amount you owed, as the IRS and the state confirmed it.",
    calibrationComplete(h) ? "satisfied" : "missing");

  if (h.members.some((m) => m.role === "adult")) {
    add("payslip", "w2_employee", "payslip", "Latest payslip",
      "The most recent pay stub for each working adult - it drives the whole tax forecast.");
    add("w2", "w2_employee", "w2", "W-2 (when available)",
      "Issued by the employer each January for the year that just ended.");
  }
  if (extras.hasBrokerage) {
    add("brokerage", "brokerage_investor", "brokerage_statement", "Latest brokerage statement",
      "Must show positions, realized gains/losses and tax lots - TaxImpact reads the lots.");
  }
  if (h.hasRsu || h.hasEspp) {
    add("stock_plan", "rsu_employee", "other", "Stock-plan statement",
      "The vest schedule and latest statement from the employer's stock plan (RSU / ESPP).");
  }
  if (extras.hasHsa) {
    add("hsa_statement", "hsa_household", "hsa_statement", "HSA statement",
      "Latest statement from the HSA provider.");
    add("hsa_election", "hsa_household", "other", "Current HSA contribution election",
      "What you elected to contribute this year - a screenshot of the benefits page is enough.");
  }
  if (extras.hasCollegeStudent) {
    add("529", "college_student", "529_statement", "529 statement",
      "Latest statement for the student's education account.");
    add("1098t", "college_student", "1098t", "1098-T (when available)",
      "The tuition statement the college issues each January.");
    add("1099q", "college_student", "1099q", "1099-Q (when available)",
      "Issued when money was withdrawn from the 529 during the year.");
    add("bursar", "college_student", "other", "Bursar ledger + scholarship information",
      "The college billing ledger and any scholarship terms - needed to coordinate 529 money with education credits.");
  }
  if (extras.hasRental) {
    add("rental_pack", "rental_owner", "other", "Rental property pack",
      "Mortgage statement, rental income and expenses, property tax bill, and last year's Schedule E.");
  }
  return reqs;
}

export interface PayrollShortcutResult {
  provisional: boolean;
  needsDocument: boolean;
  reason: string;
  consecutiveAfter: number;
}

export function payrollShortcut(grossChanged: string, netChanged: string, benefitsChanged: string, consecutiveProvisional: number): PayrollShortcutResult {
  const changed: string[] = [];
  if (grossChanged !== "no") changed.push("gross pay");
  if (netChanged !== "no") changed.push("net deposit");
  if (benefitsChanged !== "no") changed.push("benefit election");
  if (changed.length) {
    return { provisional: false, needsDocument: true, consecutiveAfter: 0, reason: `${changed.join(", ")} changed or is unsure - a new payslip is needed to keep the forecast honest.` };
  }
  if (consecutiveProvisional >= MAX_PROVISIONAL_CYCLES) {
    return { provisional: false, needsDocument: true, consecutiveAfter: consecutiveProvisional, reason: "Two provisional confirmations in a row - this cycle needs the actual payslip for full verification." };
  }
  return { provisional: true, needsDocument: false, consecutiveAfter: consecutiveProvisional + 1, reason: "Nothing changed - payroll marked provisionally unchanged for this cycle." };
}

export interface AnnualPhase { key: string; title: string; items: string[] }

const PHASES: [number, string, string, string[]][] = [
  [1, "january_reset", "January - Financial Reset", ["New federal tax rules", "New state rules", "Review the W-4", "Review state withholding", "Set 401(k) elections", "Set HSA elections", "Refresh retirement assumptions", "Set this year's goals"]],
  [2, "quarterly_check", "Quarterly - Financial Health Check", ["Bonuses", "RSU events", "ESPP events", "Investment gains", "Tax trajectory", "Retirement progress"]],
  [4, "quarterly_check", "Quarterly - Financial Health Check", ["Bonuses", "RSU events", "ESPP events", "Investment gains", "Tax trajectory", "Retirement progress"]],
  [6, "june_review", "June - Mid-Year Review", ["Withholding check", "HSA pace", "401(k) pace", "Dependent changes", "529 contributions", "Retirement pace", "Brokerage review"]],
  [7, "quarterly_check", "Quarterly - Financial Health Check", ["Bonuses", "RSU events", "ESPP events", "Investment gains", "Tax trajectory", "Retirement progress"]],
  [9, "landing_forecast", "September / October - Landing Forecast", ["Benefits enrollment", "Next year's HSA", "Health insurance choice", "Tax landing position", "Education funding"]],
  [11, "november_window", "November - Final Optimization Window", ["W-4 adjustments", "State withholding", "Capital gain harvesting", "Tax-loss harvesting", "Roth conversion", "Charitable giving", "Retirement contribution limits"]],
  [12, "december_lock", "December - Final Tax Lock", ["Know the approximate tax outcome BEFORE December 31", "No April surprises"]],
];

export function annualFocus(month: number): AnnualPhase {
  let best: AnnualPhase = { key: PHASES[0][1], title: PHASES[0][2], items: [...PHASES[0][3]] };
  for (const [start, key, title, items] of PHASES) {
    if (month >= start) best = { key, title, items: [...items] };
  }
  return best;
}

export function nextPhaseStart(month: number): { month: number; title: string } {
  for (const [start, , title] of PHASES) {
    if (start > month) return { month: start, title };
  }
  return { month: PHASES[0][0], title: PHASES[0][2] };
}

export interface NextActionInput {
  calibrationMissing: boolean;
  verificationDue: boolean;
  staleDocs?: string[];
  missingRequestLabel?: string | null;
  federalPosition?: "below" | "inside" | "above" | null;
  federalDelta?: number;
  agingDocs?: string[];
  annualPhaseTitle?: string;
  confidenceBand: string;
  confidenceScore: number;
}

export interface NextAction {
  action: string;
  why: string;
  expectedBenefit: string;
  tradeOff: string;
  confidence: string;
  whatCouldChange: string;
}

const money = (x: number) => `$${Math.round(x).toLocaleString("en-US")}`;

export function nextAction(i: NextActionInput): NextAction {
  const conf = `${i.confidenceBand} (${i.confidenceScore}/100)`;
  const stale = i.staleDocs ?? [];
  const aging = i.agingDocs ?? [];
  const delta = i.federalDelta ?? 0;
  if (i.verificationDue) {
    return { action: "Upload the latest payslip", why: "The payroll shortcut has used its provisional confirmations - this cycle needs the real document to stay verified.", expectedBenefit: "Keeps the tax forecast at decision grade instead of drifting on assumptions.", tradeOff: "About two minutes to upload a photo or file.", confidence: conf, whatCouldChange: "Nothing - verification is due regardless; the forecast re-checks itself right after." };
  }
  if (i.calibrationMissing) {
    return { action: "Add last year's filed return and its actual outcome", why: "Calibration is the anchor of the whole forecast: what you filed last year and what the IRS and state actually did with it.", expectedBenefit: "The single largest confidence gain available - worth up to 20 of the 100 confidence points.", tradeOff: "One-time effort; HomeTower asks only until it is recorded.", confidence: conf, whatCouldChange: "Once recorded, the top action moves to whatever is stale or off-target." };
  }
  if (stale.length) {
    return { action: `Update the ${stale[0]}`, why: "It is past its freshness window, so the forecast is running on old numbers for it.", expectedBenefit: "Restores that part of the forecast to current data and lifts the confidence score.", tradeOff: "About two minutes to upload the newer document.", confidence: conf, whatCouldChange: "A newer document changes the numbers it feeds - the forecast recomputes immediately." };
  }
  if (i.federalPosition === "below") {
    return { action: "Increase federal withholding (or set aside the difference)", why: `The forecast lands ${money(delta)} below your refund target band.`, expectedBenefit: `Closes a ${money(delta)} gap before December, while there are still pay cycles left to spread it over.`, tradeOff: "Slightly smaller take-home pay for the rest of the year.", confidence: conf, whatCouldChange: "A bonus, an RSU vest or a deduction change would move the forecast - recheck after any of them." };
  }
  if (i.federalPosition === "above") {
    return { action: "Consider reducing federal withholding", why: `The forecast lands ${money(delta)} above your refund target band - that is an interest-free loan to the IRS (SPEC45 sec. 22: never maximize a refund blindly).`, expectedBenefit: `Frees roughly ${money(delta)} of cash flow across the remaining pay cycles instead of next spring.`, tradeOff: "A smaller refund next spring - by design, not by surprise.", confidence: conf, whatCouldChange: "If you prefer the forced-savings effect of a big refund, keep the target band as it is." };
  }
  if (i.missingRequestLabel) {
    return { action: `Add the ${i.missingRequestLabel}`, why: "Your household profile asks for it - it feeds a part of the forecast that is currently estimated.", expectedBenefit: "Replaces an estimate with a document fact and lifts the confidence score.", tradeOff: "About two minutes to upload a photo or file.", confidence: conf, whatCouldChange: "Nothing structural - each document you add narrows what is still estimated." };
  }
  if (aging.length) {
    return { action: `Refresh the ${aging[0]} soon`, why: "It is inside the last days of its freshness window.", expectedBenefit: "Avoids a stale-data flag and a confidence drop next week.", tradeOff: "About two minutes when the new statement is available.", confidence: conf, whatCouldChange: "If no newer statement exists yet, this simply waits - the window is a warning, not an error." };
  }
  return { action: "You're on track - review this month's snapshot", why: `Nothing is stale, missing or off target. Current phase: ${i.annualPhaseTitle ?? ""}.`, expectedBenefit: "A two-minute review keeps the household record - and the forecast - honest.", tradeOff: "None.", confidence: conf, whatCouldChange: "Any new document, job change or market move reopens the action list." };
}
