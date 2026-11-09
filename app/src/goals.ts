// Goal projection helper for the dashboard gauges.
// Compound growth with monthly contributions. The assumed return is an
// explicit, editable input - labelled on screen, never hidden.
export function projectValue(balance: number, monthly: number, years: number, annualReturnPct: number): number {
  const months = Math.max(0, Math.round(years * 12));
  const r = annualReturnPct / 100 / 12;
  if (months === 0) return balance;
  if (r === 0) return balance + monthly * months;
  const growth = Math.pow(1 + r, months);
  return balance * growth + monthly * ((growth - 1) / r);
}

export function goalPct(projected: number, target: number): number | null {
  if (target <= 0) return null; // no target set - the gauge says so instead of faking a number
  return Math.round((projected / target) * 100);
}

export function ageOn(dob: string, today: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const [y, m, d] = dob.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  let age = ty - y;
  if (tm < m || (tm === m && td < d)) age -= 1;
  return age;
}

/** Plain-language education line for one child, from the My House table. */
export function educationLine(name: string, dob: string, studentNow: boolean, collegeStartYear: number, yearsLeft: number, today: string): string {
  const age = ageOn(dob, today);
  if (studentNow) return `${name}: in college now${yearsLeft > 0 ? `, about ${yearsLeft} year${yearsLeft === 1 ? "" : "s"} left` : ""}.`;
  if (collegeStartYear > 0) {
    const years = collegeStartYear - Number(today.slice(0, 4));
    return `${name}: starts college in ${collegeStartYear}${years > 0 ? ` (${years} year${years === 1 ? "" : "s"})` : ""}.`;
  }
  if (age !== null) {
    const startYear = Number(today.slice(0, 4)) + (18 - age);
    return `${name}: age ${age} - college around ${startYear} if they start at 18.`;
  }
  return `${name}: add a date of birth in My House to time the education savings.`;
}

/** Rough rule-of-thumb retirement need: 25x the income you want to
 * replace, at a 70% replacement rate. Always labelled as a rule of
 * thumb on screen - an estimate the user can accept or override. */
export function retirementNeedEstimate(annualIncome: number): number {
  if (annualIncome <= 0) return 0;
  return Math.round(annualIncome * 0.7 * 25);
}

/** Starting withdrawal rates (owner QA round 46, Copilot's pension
 * review): a PARAMETER with named scenarios, never a hardcoded 25x -
 * 25 is just 1 / 4%. ~3.9% is the cited rate for a 30-year retirement
 * at 90% success; the base case here is 4.0%. */
export const WITHDRAWAL_RATES = { conservative: 0.035, base: 0.04, flexible: 0.045 } as const;

export interface HouseholdRetirement {
  spendingAnnual: number;
  dependableAnnual: number; // Social Security + pension + other dependable income
  portfolioGapAnnual: number; // the yearly spending the portfolio itself must fund
  needBase: number; // portfolio required at the base 4.0% rate
  needConservative: number; // at 3.5%
  needFlexible: number; // at 4.5%
  projectedIncomeAnnual: number; // dependable + projected portfolio x base rate
  incomeGapAnnual: number; // spending - projected income (negative = covered with spare)
}

/** Retirement need is a HOUSEHOLD figure (round 46): a couple sharing
 * one home does not need twice a single's portfolio - housing,
 * utilities, insurance and food are shared. The need is the spending
 * the portfolio must fund after dependable income, divided by the
 * starting withdrawal rate. A single is the same math with one
 * person\'s inputs - there is no per-person doubling rule. */
export function householdRetirement(input: {
  spendingAnnual: number;
  socialSecurityAnnual: number;
  pensionAnnual: number;
  otherAnnual: number;
  projectedPortfolio: number;
}): HouseholdRetirement {
  const dependable =
    Math.max(0, input.socialSecurityAnnual) + Math.max(0, input.pensionAnnual) + Math.max(0, input.otherAnnual);
  const gap = Math.max(0, input.spendingAnnual - dependable);
  const needAt = (rate: number) => (gap > 0 ? Math.round(gap / rate) : 0);
  const projectedIncome = dependable + Math.max(0, input.projectedPortfolio) * WITHDRAWAL_RATES.base;
  return {
    spendingAnnual: input.spendingAnnual,
    dependableAnnual: dependable,
    portfolioGapAnnual: gap,
    needBase: needAt(WITHDRAWAL_RATES.base),
    needConservative: needAt(WITHDRAWAL_RATES.conservative),
    needFlexible: needAt(WITHDRAWAL_RATES.flexible),
    projectedIncomeAnnual: Math.round(projectedIncome),
    incomeGapAnnual: Math.round(input.spendingAnnual - projectedIncome),
  };
}

/** Value of one person's savings at a COMMON household date (round
 * 47, the timeline fix): contributions stop at their own retirement,
 * then the balance keeps growing - no draws - until the common date.
 * Summing two projections taken at different dates was the round-46
 * shortcut Copilot flagged; every household figure is now valued at
 * the later retirement date. */
export function projectToCommonDate(balance: number, monthly: number, yearsContributing: number, yearsTotal: number, annualReturnPct: number): number {
  const atOwn = projectValue(balance, monthly, yearsContributing, annualReturnPct);
  return projectValue(atOwn, 0, Math.max(0, yearsTotal - yearsContributing), annualReturnPct);
}

/** Today's purchasing power of a future amount, and its inverse
 * (round 47): retirement figures are presented in today's dollars
 * first, with the future-dollar equivalent shown second. */
export function deflateToToday(amount: number, years: number, inflationPct: number): number {
  if (years <= 0 || inflationPct <= 0) return amount;
  return amount / Math.pow(1 + inflationPct / 100, years);
}
export function inflateToFuture(amount: number, years: number, inflationPct: number): number {
  if (years <= 0 || inflationPct <= 0) return amount;
  return amount * Math.pow(1 + inflationPct / 100, years);
}

export type RetirementAccuracyLevel = "X" | "X+" | "X++";
export interface RetirementAccuracy {
  level: RetirementAccuracyLevel;
  label: string; // "Early estimate" | "Planning forecast" | "High-confidence planning forecast"
  missing: string[]; // the personalization asks, in the order to present them
}

/** Accuracy levels for the retirement forecast (round 47, Copilot's
 * scale): X = only age + income known, the card is an early estimate
 * and must not read as a verdict; X+ = the funding path and at least
 * one personal input are known; X++ = a real spending target, Social
 * Security for every adult, pension known (or none, by declaration)
 * and balances on file. */
export function retirementAccuracy(input: {
  spendingSet: boolean;
  ssEnteredAdults: number;
  adultCount: number;
  pensionKnown: boolean;
  hasBalances: boolean;
  hasPace: boolean;
}): RetirementAccuracy {
  const missing: string[] = [];
  if (!input.spendingSet) missing.push("a retirement spending target of your own");
  if (input.adultCount > 0 && input.ssEnteredAdults < input.adultCount) missing.push("a Social Security estimate for each adult");
  if (!input.pensionKnown) missing.push("pension or other dependable retirement income");
  const hasFunding = input.hasBalances || input.hasPace;
  if (input.spendingSet && input.adultCount > 0 && input.ssEnteredAdults >= input.adultCount && input.pensionKnown && input.hasBalances) {
    return { level: "X++", label: "High-confidence planning forecast", missing };
  }
  if (hasFunding && (input.spendingSet || input.ssEnteredAdults > 0 || input.pensionKnown)) {
    return { level: "X+", label: "Planning forecast", missing };
  }
  return { level: "X", label: "Early estimate", missing };
}

export type LifestyleCategoryState = "continues" | "ends" | "changes";

export interface LifestyleData {
  amounts: Record<string, number>; // what the household spends today, $/yr, per category
  states: Record<string, LifestyleCategoryState>; // group-1 rows only; group 2 always ends
  adjusted: Record<string, number>; // group-1 "changes" rows: the $/yr in retirement
  additionsAnnual: number; // retirement-only additions $/yr
  confirmed: boolean; // the user confirmed this target - only then does Home use it
}

export interface LifestyleCategory {
  key: string;
  label: string;
  group: 1 | 2;
}

/** The Retirement Lifestyle taxonomy (round 48, Copilot's
 * expense-based method). Group 1 is lifestyle spending: each row
 * continues into retirement, ends, or changes amount. Group 2 is
 * savings and work costs: NOT lifestyle spending - 401(k)/HSA/ESPP/
 * 529 contributions, payroll taxes and commuting are exactly what
 * a percentage-of-gross fallback wrongly counts as retirement
 * spending, which is a core reason that fallback inflates the
 * target. Group-2 rows end at retirement by definition. */
export const LIFESTYLE_CATEGORIES: LifestyleCategory[] = [
  { key: "housing", label: "Housing (mortgage or rent)", group: 1 },
  { key: "property_tax_hoa", label: "Property tax & HOA", group: 1 },
  { key: "utilities", label: "Utilities", group: 1 },
  { key: "food", label: "Food", group: 1 },
  { key: "transportation", label: "Transportation", group: 1 },
  { key: "insurance", label: "Insurance", group: 1 },
  { key: "healthcare", label: "Healthcare", group: 1 },
  { key: "travel", label: "Travel", group: 1 },
  { key: "entertainment", label: "Entertainment", group: 1 },
  { key: "home_maintenance", label: "Home maintenance", group: 1 },
  { key: "personal", label: "Personal spending", group: 1 },
  { key: "taxes_retirement", label: "Taxes in retirement", group: 1 },
  { key: "other", label: "Other spending", group: 1 },
  { key: "k401", label: "401(k) contributions", group: 2 },
  { key: "hsa_contrib", label: "HSA contributions", group: 2 },
  { key: "espp", label: "ESPP purchases", group: 2 },
  { key: "contrib529", label: "529 contributions", group: 2 },
  { key: "payroll_taxes", label: "Payroll taxes", group: 2 },
  { key: "work_commuting", label: "Work & commuting", group: 2 },
  { key: "college_support", label: "College support (ends when studies end)", group: 2 },
  { key: "mortgage_ending", label: "Mortgage that ends before retirement", group: 2 },
];

export const LIFESTYLE_GROUP1 = LIFESTYLE_CATEGORIES.filter((c) => c.group === 1);
export const LIFESTYLE_GROUP2 = LIFESTYLE_CATEGORIES.filter((c) => c.group === 2);

export interface LifestyleBreakdown {
  currentSpending: number; // everything the household spends today: both groups
  endingTotal: number; // group 2 in full + group-1 rows marked Ends
  changesDelta: number; // signed: sum of (in-retirement - today) over Changes rows
  additions: number; // retirement-only additions
  lifestyleAnnual: number; // the retirement lifestyle target, today's dollars
  lifestyleToday: number; // group-1 today total, before states are applied
}

/** The waterfall identity, by construction:
 * currentSpending - endingTotal + changesDelta + additions
 *   = lifestyleAnnual.
 * Continues rows contribute today's amount; Changes rows contribute
 * their adjusted amount (today's amount until one is entered); Ends
 * rows and all of group 2 contribute nothing. */
export function lifestyleBreakdown(l: LifestyleData): LifestyleBreakdown {
  const amt = (k: string) => Math.max(0, l.amounts[k] || 0);
  let g1Today = 0;
  let g2Today = 0;
  let endsG1 = 0;
  let changesDelta = 0;
  let lifestyle = 0;
  for (const c of LIFESTYLE_GROUP1) {
    const a = amt(c.key);
    g1Today += a;
    const st = l.states[c.key] ?? "continues";
    if (st === "ends") {
      endsG1 += a;
    } else if (st === "changes") {
      const adj = Math.max(0, l.adjusted[c.key] ?? a);
      changesDelta += adj - a;
      lifestyle += adj;
    } else {
      lifestyle += a;
    }
  }
  for (const c of LIFESTYLE_GROUP2) g2Today += amt(c.key);
  const additions = Math.max(0, l.additionsAnnual || 0);
  lifestyle += additions;
  return {
    currentSpending: g1Today + g2Today,
    endingTotal: g2Today + endsG1,
    changesDelta,
    additions,
    lifestyleAnnual: lifestyle,
    lifestyleToday: g1Today,
  };
}

// ---------------------------------------------------------------------------
// ROUND 49 - quick estimate, exceptions overlays, spending precedence,
// Social Security statement fallback. The round-48 category model stays
// untouched; these helpers layer the upload-first UX on top of it.
// ---------------------------------------------------------------------------

/** The 60-second estimate: one monthly spend figure plus the exceptions
 * that end before retirement. Structurally identical to the store shape. */
export interface QuickEstimateData {
  monthlySpend: number;
  mortgageEndsMonthly: number;
  collegeEndsAnnual: number;
  travelAdjustPct: number; // signed percent applied to today's spending
  healthcareBridgeAnnual: number;
  done: boolean;
}

export interface QuickBreakdown {
  currentSpending: number;
  endingTotal: number;
  travelDelta: number; // signed $/yr
  lifestyleAnnual: number;
}

export function quickBreakdown(q: QuickEstimateData): QuickBreakdown {
  const currentSpending = Math.max(0, q.monthlySpend || 0) * 12;
  const endingTotal = Math.max(0, q.mortgageEndsMonthly || 0) * 12 + Math.max(0, q.collegeEndsAnnual || 0);
  const travelDelta = Math.round((currentSpending * (q.travelAdjustPct || 0)) / 100);
  const lifestyleAnnual = Math.max(0, currentSpending - endingTotal + travelDelta + Math.max(0, q.healthcareBridgeAnnual || 0));
  return { currentSpending, endingTotal, travelDelta, lifestyleAnnual };
}

/** The exception answers statements cannot supply. Structurally
 * identical to the store shape. majorChangeAnnual is SIGNED. */
export interface LifestyleExceptions {
  mortgageAtRetirement: "" | "still" | "ends" | "none";
  mortgageMonthly: number;
  collegeContinuesAnnual: number;
  healthcareBridgeAnnual: number;
  majorChangeAnnual: number;
  travel: "" | "more" | "same" | "less";
}

export interface LifestyleEffective {
  breakdown: LifestyleBreakdown;
  /** Housing-row amount restored into the base when the mortgage
   * overlay guard fires (the row already ends, so the payment is
   * already out of the lifestyle figure; the guard compares against
   * the row's continues value instead of subtracting it twice). */
  housingRestored: number;
  mortgageOverlay: number; // $/yr removed because the mortgage ends
  collegeContinues: number;
  healthcareBridge: number;
  majorChange: number; // signed
  lifestyleAnnual: number;
  /** What leaves before retirement, display-ready: the breakdown's
   * ending total plus the mortgage overlay, minus restored housing. */
  endingTotal: number;
}

export function lifestyleEffective(l: LifestyleData, ex: LifestyleExceptions): LifestyleEffective {
  const bd = lifestyleBreakdown(l);
  const housingAmt = Math.max(0, l.amounts["housing"] || 0);
  const housingEnds = (l.states["housing"] ?? "continues") === "ends";
  let housingRestored = 0;
  let mortgageOverlay = 0;
  if (ex.mortgageAtRetirement === "ends") {
    if (housingEnds) {
      // Double-count guard: the whole housing row already ends, so the
      // mortgage payment is already out. The overlay is skipped and the
      // base is read against the row's continues value.
      housingRestored = housingAmt;
    } else {
      mortgageOverlay = Math.max(0, ex.mortgageMonthly || 0) * 12;
    }
  }
  const collegeContinues = Math.max(0, ex.collegeContinuesAnnual || 0);
  const healthcareBridge = Math.max(0, ex.healthcareBridgeAnnual || 0);
  const majorChange = ex.majorChangeAnnual || 0; // signed on purpose
  const lifestyleAnnual = Math.max(0, bd.lifestyleAnnual + housingRestored - mortgageOverlay + collegeContinues + healthcareBridge + majorChange);
  return {
    breakdown: bd,
    housingRestored,
    mortgageOverlay,
    collegeContinues,
    healthcareBridge,
    majorChange,
    lifestyleAnnual,
    endingTotal: bd.endingTotal + mortgageOverlay - housingRestored,
  };
}

export type SpendingTier = "confirmed" | "set" | "quick" | "none";

export interface SpendingChoice {
  spendingAnnual: number;
  tier: SpendingTier;
  lifestyleAnnual: number; // effective category-path figure (may be 0)
}

/** Home's spending precedence (round 49): confirmed lifestyle, then a
 * custom figure, then the budget worksheet, then the quick estimate,
 * then the 70%-of-income placeholder. First positive wins. */
export function chooseSpending(input: {
  lifestyle: LifestyleData;
  exceptions: LifestyleExceptions;
  customAnnual: number;
  budgetTotal: number;
  quick: QuickEstimateData;
  fallback: number;
}): SpendingChoice {
  const eff = lifestyleEffective(input.lifestyle, input.exceptions);
  if (input.lifestyle.confirmed && eff.lifestyleAnnual > 0) {
    return { spendingAnnual: eff.lifestyleAnnual, tier: "confirmed", lifestyleAnnual: eff.lifestyleAnnual };
  }
  if (input.customAnnual > 0) return { spendingAnnual: input.customAnnual, tier: "set", lifestyleAnnual: eff.lifestyleAnnual };
  if (input.budgetTotal > 0) return { spendingAnnual: input.budgetTotal, tier: "set", lifestyleAnnual: eff.lifestyleAnnual };
  if (input.quick.done) {
    const qb = quickBreakdown(input.quick);
    if (qb.lifestyleAnnual > 0) return { spendingAnnual: qb.lifestyleAnnual, tier: "quick", lifestyleAnnual: eff.lifestyleAnnual };
  }
  return { spendingAnnual: input.fallback, tier: "none", lifestyleAnnual: eff.lifestyleAnnual };
}

/** ROUND 50 - display gating for the Retirement Lifestyle page.
 *
 * The defect this fixes (Copilot, from the owner's device): a
 * household whose lifestyle model held ONLY Group-2 data - the
 * payslip 401(k) prefill; zero Group-1 living spending - was shown
 * the RESULT view with savings contributions presented as household
 * spending ("You spend about $44,865/yr today") and a "$0/yr"
 * retirement lifestyle presented as an estimate. Both are forbidden
 * by the product's honesty rules: Group-2 amounts (savings, payroll
 * taxes, work costs, college support, an ending mortgage) are NEVER
 * spending evidence, and a lifestyle that is not estimated is never
 * shown as a $0 figure. */
export const LIFESTYLE_NOT_ESTIMATED = "Not estimated yet";

export function lifestyleGroupTotals(l: LifestyleData): { group1Total: number; group2Total: number } {
  const sum = (cats: LifestyleCategory[]) => cats.reduce((s, c) => s + (l.amounts[c.key] ?? 0), 0);
  return { group1Total: sum(LIFESTYLE_GROUP1), group2Total: sum(LIFESTYLE_GROUP2) };
}

export interface LifestyleDisplayState {
  group1Total: number;
  group2Total: number;
  /** Spending evidence exists: Group-1 living-spending amounts, a
   * confirmed lifestyle, or a completed quick estimate. Group-2
   * amounts NEVER count. */
  hasSpendingEvidence: boolean;
  /** The result view (headline lines, waterfall, output block) may
   * render only when this is true. */
  showResult: boolean;
  /** The effective retirement lifestyle on the active path. */
  lifestyleAnnual: number;
  /** "" when the figure may be shown; LIFESTYLE_NOT_ESTIMATED when
   * the figure must render as "Not estimated yet" - no spending
   * evidence, or a computed lifestyle of $0. */
  lifestyleLabel: string;
}

export function lifestyleDisplayState(l: LifestyleData, q: QuickEstimateData, ex: LifestyleExceptions): LifestyleDisplayState {
  const { group1Total, group2Total } = lifestyleGroupTotals(l);
  const hasSpendingEvidence = group1Total > 0 || l.confirmed || q.done;
  const anyAmount = Object.values(l.amounts).some((v) => v > 0) || l.additionsAnnual > 0;
  const catPath = anyAmount || l.confirmed;
  const lifestyleAnnual = catPath ? lifestyleEffective(l, ex).lifestyleAnnual : quickBreakdown(q).lifestyleAnnual;
  return {
    group1Total,
    group2Total,
    hasSpendingEvidence,
    showResult: hasSpendingEvidence,
    lifestyleAnnual,
    lifestyleLabel: !hasSpendingEvidence || lifestyleAnnual <= 0 ? LIFESTYLE_NOT_ESTIMATED : "",
  };
}

/** ROUND 50 - wizard step 3: pension information is already on file
 * when any member carries a pension amount, the household pension
 * field is set, or a pension statement reading exists. In that case
 * answering "No" to expected retirement income must NOT set the
 * noPension flag - the data stays in the forecast. */
export function pensionOnFile(input: { memberPensionAnnual: number; householdPensionAnnual: number; pensionStatementMonthly: number }): boolean {
  return input.memberPensionAnnual > 0 || input.householdPensionAnnual > 0 || input.pensionStatementMonthly > 0;
}

/** Minimal document shape the Social Security helpers read. */
export interface SsDocLike {
  docType: string;
  ownerMemberId?: string | null;
  capturedOn?: string | null;
  fields?: Record<string, string>;
}

/** The freshest Social Security statement reading owned by a member. */
export function ssStatementFor(docs: SsDocLike[], memberId: string): { monthly: number; capturedOn: string | null } | null {
  let best: { monthly: number; capturedOn: string | null } | null = null;
  for (const d of docs) {
    if (d.docType !== "ssa_statement" || d.ownerMemberId !== memberId || !d.fields) continue;
    const v = Number(String(d.fields["monthly_benefit_estimate"] ?? "").replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(v) || v <= 0) continue;
    if (!best || (d.capturedOn ?? "") >= (best.capturedOn ?? "")) best = { monthly: v, capturedOn: d.capturedOn ?? null };
  }
  return best;
}

/** Dependable Social Security for one adult: a typed-in figure wins;
 * otherwise the member's own statement (monthly benefit x 12). */
export function ssForMember(
  member: { id: string; ssAnnual?: number | null },
  docs: SsDocLike[],
): { annual: number; source: "manual" | "statement" | "none"; statementOn: string | null } {
  if ((member.ssAnnual ?? 0) > 0) return { annual: member.ssAnnual ?? 0, source: "manual", statementOn: null };
  const st = ssStatementFor(docs, member.id);
  if (st) return { annual: Math.round(st.monthly * 12), source: "statement", statementOn: st.capturedOn };
  return { annual: 0, source: "none", statementOn: null };
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "November 2026" from an ISO date; "" when unparseable. */
export function monthYearLabel(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}/.test(iso)) return "";
  const m = Number(iso.slice(5, 7));
  if (!(m >= 1 && m <= 12)) return "";
  return `${MONTH_NAMES[m - 1]} ${iso.slice(0, 4)}`;
}

// ---------------------------------------------------------------------------
// ROUND 51 - Copilot's source architecture, wired: statements say what
// the household HAS, payroll says what it ADDS (employee pace AND
// employer match pace, both from payslips.ts), assumptions say how it
// GROWS, bank/card evidence says what it NEEDS, SSA/pension documents
// say what the portfolio does NOT need to fund. The two helpers below
// close the balance half of that doctrine; the match pace lives in
// payslips.ts next to the employee pace it parallels.
// ---------------------------------------------------------------------------

/** The freshest 401(k) statement reading owned by a member (the
 * round-49 owner pattern, applied to 401k_statement): statements
 * carry no reliable printed owner name, so only a statement the user
 * assigned to this member on the confirm card counts. Statements
 * saved before owners existed stay Documents-card-only. */
export function k401StatementFor(docs: SsDocLike[], memberId: string): { balance: number; capturedOn: string | null } | null {
  let best: { balance: number; capturedOn: string | null } | null = null;
  for (const d of docs) {
    if (d.docType !== "401k_statement" || d.ownerMemberId !== memberId || !d.fields) continue;
    const v = Number(String(d.fields["ending_balance"] ?? "").replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(v) || v <= 0) continue;
    if (!best || (d.capturedOn ?? "") >= (best.capturedOn ?? "")) best = { balance: v, capturedOn: d.capturedOn ?? null };
  }
  return best;
}

export interface AdultStartingBalance {
  balance: number;
  /** True when an owned statement supplied (or replaced) the 401(k)
   * sleeve of this adult's starting balance. */
  statementApplied: boolean;
  /** The value of the adult's own 401(k) asset rows the statement
   * replaced (0 when it replaced nothing or did not apply). */
  replaced401k: number;
}

/** One adult's projection starting balance, with statement
 * precedence (round 51): when the adult has an owned 401(k)
 * statement, its ending balance IS the starting balance of their
 * 401(k) sleeve - it replaces the sum of their own 401(k) asset
 * rows, so the same account is never counted twice; their other
 * kinds (IRA, HSA) are untouched, and the payslip pace still sets
 * future contributions either way. With no owned statement the
 * composition is exactly what it was before this round: the sum of
 * the adult's name-matched asset rows, or the caller's fallback
 * when they have none. The one case precedence does NOT reach: an
 * adult with no name-matched rows whose fallback is a household
 * aggregate (it already lumps every 401(k)/IRA row, attributed or
 * not, so the statement's dollars are in there but cannot be
 * separated back out without guessing - no guessing). */
export function adultStartingBalance(input: {
  owned: Array<{ kind: string; value: number }>;
  fallback: number;
  statement401k: number;
}): AdultStartingBalance {
  const ownedSum = input.owned.reduce((s, a) => s + a.value, 0);
  if (!(input.statement401k > 0)) {
    return { balance: input.owned.length ? ownedSum : input.fallback, statementApplied: false, replaced401k: 0 };
  }
  if (input.owned.length > 0) {
    const own401 = input.owned.filter((a) => a.kind === "401k").reduce((s, a) => s + a.value, 0);
    return { balance: ownedSum - own401 + input.statement401k, statementApplied: true, replaced401k: own401 };
  }
  if (!(input.fallback > 0)) {
    return { balance: input.statement401k, statementApplied: true, replaced401k: 0 };
  }
  return { balance: input.fallback, statementApplied: false, replaced401k: 0 };
}

/** Monthly contribution needed to reach a target from a balance in a
 * given number of years (the inverse of projectValue). */
export function requiredMonthly(balance: number, target: number, years: number, annualReturnPct: number): number {
  const months = Math.max(0, Math.round(years * 12));
  if (months === 0) return 0;
  const r = annualReturnPct / 100 / 12;
  if (r === 0) return Math.max(0, (target - balance) / months);
  const growth = Math.pow(1 + r, months);
  return Math.max(0, ((target - balance * growth) * r) / (growth - 1));
}

/** Earliest age (searching fromAge..capAge) at which the projected
 * value reaches the need - the "when IS it realistic" answer. */
export function earliestAgeReaching(balance: number, monthly: number, need: number, annualReturnPct: number, currentAge: number, fromAge: number, capAge = 80): number | null {
  for (let age = Math.max(fromAge, currentAge); age <= capAge; age++) {
    if (projectValue(balance, monthly, age - currentAge, annualReturnPct) >= need) return age;
  }
  return null;
}

export interface EducationFunding {
  needAtStart: number;      // total inflated net cost of all college years, valued at start
  projectedAtStart: number; // savings projected to the start date
  gap: number;
  pctFunded: number | null; // null when there is no cost estimate yet
  requiredMonthly: number;  // contribution that closes the gap by the start
}

/** SPEC45 sec. 32 core: per-child funding status. Costs inflate at
 * inflationPct per year until each college year arrives; scholarships
 * reduce each year; contributions run until college starts. */
export function educationFunding(balance: number, monthly: number, yearsToStart: number, durationYears: number,
  annualCost: number, scholarshipPerYear: number, annualReturnPct: number, inflationPct = 3): EducationFunding {
  const net = Math.max(0, annualCost - scholarshipPerYear);
  let needAtStart = 0;
  for (let i = 0; i < Math.max(0, durationYears); i++) {
    const inflated = net * Math.pow(1 + inflationPct / 100, yearsToStart + i);
    needAtStart += inflated / Math.pow(1 + annualReturnPct / 100, i); // later years discounted back to start
  }
  const projectedAtStart = projectValue(balance, monthly, yearsToStart, annualReturnPct);
  const gap = Math.max(0, needAtStart - projectedAtStart);
  return {
    needAtStart: Math.round(needAtStart),
    projectedAtStart: Math.round(projectedAtStart),
    gap: Math.round(gap),
    pctFunded: needAtStart > 0 ? Math.round((projectedAtStart / needAtStart) * 100) : null,
    requiredMonthly: Math.round(requiredMonthly(balance, needAtStart, yearsToStart, annualReturnPct)),
  };
}
