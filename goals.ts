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

// ---------------------------------------------------------------------------
// ROUND 52 - Directional Retirement Outlook, Provenance and Navigation
// (Copilot's full spec, approved verbatim by the owner). Three pieces:
// (1) provenance - every document-derived value carries a status and
// a source, and an unknown value is NEVER a $0; (2) the directional
// outlook - at low accuracy the household still gets an answer to
// "am I heading toward the retirement age I asked for?", computed
// deterministically from three return scenarios (5% / 6% / 7%), with
// NO numeric probability anywhere; (3) the one recommended action,
// chosen from three computed levers by the spec's plausibility order.
// ---------------------------------------------------------------------------

/** Provenance statuses (spec section F). A value the source confirms
 * is zero renders as $0; a value nobody has supplied renders as
 * Unknown; a value a parser looked for and did not find renders as
 * Not detected. UNKNOWN != 0 and NOT_DETECTED != 0 are hard rules
 * across all of HomeTower, not only Retirement. */
export type ValueStatus = "confirmed" | "user_confirmed" | "from_payslip" | "from_statement" | "estimated" | "not_detected" | "unknown" | "stale";

export function valueStatusLabel(status: ValueStatus): string {
  switch (status) {
    case "from_payslip": return "From payslip";
    case "from_statement": return "From statement";
    case "user_confirmed": return "Entered by you";
    case "estimated": return "Estimated";
    case "not_detected": return "Not detected";
    case "stale": return "Stale";
    case "confirmed": return "Confirmed";
    default: return "Unknown";
  }
}

function docFieldNum(d: SsDocLike, key: string): number | null {
  const raw = d.fields?.[key];
  if (raw === undefined || raw === "") return null;
  const v = Number(String(raw).replace(/[^0-9.]/g, ""));
  return Number.isFinite(v) ? v : null;
}

function docHasPositive(d: SsDocLike, keys: string[]): boolean {
  return keys.some((k) => (docFieldNum(d, k) ?? 0) > 0);
}

/** Whether the household's documents carry an item at all - the
 * badge logic behind the Documents cards and the Lifestyle savings
 * rows (GT7: ESPP not found renders "Unknown", never "$0"). Returns
 * the source status when a document carries the item, "not_detected"
 * when a relevant document exists but the item is absent from it,
 * and "unknown" when no relevant document exists yet. A value the
 * USER typed is not this helper's business - typed values are real
 * values (user_confirmed), including a typed 0. */
export function docEvidenceStatus(docs: SsDocLike[], item: "espp" | "hsa" | "529" | "match" | "payroll_taxes"): ValueStatus {
  const slips = docs.filter((d) => d.docType === "payslip");
  if (item === "payroll_taxes") {
    // Payroll taxes live on the payslip itself: federal, state and
    // Medicare withholding lines, current or year-to-date.
    if (slips.some((d) => docHasPositive(d, ["federal_withheld", "ytd_federal_withheld", "state_withheld", "ytd_state_withheld", "medicare_withheld", "ytd_medicare_withheld"]))) return "from_payslip";
    return slips.length > 0 ? "not_detected" : "unknown";
  }
  if (item === "espp") {
    if (slips.some((d) => docHasPositive(d, ["espp_contribution", "ytd_espp"]))) return "from_payslip";
    return slips.length > 0 ? "not_detected" : "unknown";
  }
  if (item === "hsa") {
    if (slips.some((d) => docHasPositive(d, ["hsa_contribution", "ytd_hsa"]))) return "from_payslip";
    const stmts = docs.filter((d) => d.docType === "hsa_statement");
    if (stmts.some((d) => docHasPositive(d, ["employee_contribution", "employer_contribution", "total_contributions"]))) return "from_statement";
    return slips.length > 0 || stmts.length > 0 ? "not_detected" : "unknown";
  }
  if (item === "529") {
    const stmts = docs.filter((d) => d.docType === "529_statement");
    if (stmts.some((d) => docHasPositive(d, ["monthly_contribution", "contributions_total"]))) return "from_statement";
    return stmts.length > 0 ? "not_detected" : "unknown";
  }
  // Employer match: payslip first, then an owned-or-any 401(k)
  // statement's employer line (detection only - the per-adult
  // resolution below is owner-strict, AC-D3).
  if (slips.some((d) => docHasPositive(d, ["k401_employer_match", "ytd_k401_employer_match"]))) return "from_payslip";
  const k401 = docs.filter((d) => d.docType === "401k_statement");
  if (k401.some((d) => docHasPositive(d, ["employer_contribution_period", "employer_contributions"]))) return "from_statement";
  return slips.length > 0 || k401.length > 0 ? "not_detected" : "unknown";
}

/** Whole months covered by a statement's own period fields, when the
 * extractor captured them: an explicit months figure, a start/end
 * pair, or a period range string ("07/01/2026 - 09/30/2026"). Null
 * when the statement does not say how long its period is - a total
 * without a period length is detected, never paced by guessing. */
export function statementPeriodMonths(fields: Record<string, string>): number | null {
  const explicit = Number(String(fields["statement_period_months"] ?? "").replace(/[^0-9.]/g, ""));
  if (Number.isFinite(explicit) && explicit > 0) return Math.round(explicit);
  const parseDate = (s: string | undefined): number | null => {
    if (!s) return null;
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (iso) return Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    const us = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
    if (us) return Date.UTC(Number(us[3]), Number(us[1]) - 1, Number(us[2]));
    return null;
  };
  const monthsBetween = (a: number, b: number): number | null => {
    if (b <= a) return null;
    const months = Math.round((b - a) / (30.4375 * 86400000));
    return months >= 1 ? months : null;
  };
  const start = parseDate(fields["statement_period_start"]);
  const end = parseDate(fields["statement_period_end"]);
  if (start !== null && end !== null) return monthsBetween(start, end);
  const range = fields["statement_period"];
  if (range) {
    const dates = range.match(/\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}/g);
    if (dates && dates.length >= 2) {
      const a = parseDate(dates[0]);
      const b = parseDate(dates[dates.length - 1]);
      if (a !== null && b !== null) return monthsBetween(a, b);
    }
  }
  return null;
}

export interface StatementMatch {
  /** Monthly employer match derived from the statement's period
   * total; null when the total was detected but the statement does
   * not state its period length, so no pace may be derived. */
  monthly: number | null;
  periodTotal: number;
  months: number | null;
  capturedOn: string | null;
}

/** The freshest 401(k) statement OWNED by a member that carries an
 * employer-contribution figure (spec section F: the statement is
 * the fallback source for employer match when the payslip has
 * none). AC-D3: a statement with no identified owner is never used
 * for a person - no guessing whose match it is. */
export function k401StatementMatchFor(docs: SsDocLike[], memberId: string): StatementMatch | null {
  let best: (StatementMatch & { capturedKey: string }) | null = null;
  for (const d of docs) {
    if (d.docType !== "401k_statement" || d.ownerMemberId !== memberId || !d.fields) continue;
    const total = docFieldNum(d, "employer_contribution_period") ?? docFieldNum(d, "employer_contributions");
    if (total === null || total <= 0) continue;
    const key = d.capturedOn ?? "";
    if (!best || key >= best.capturedKey) {
      const months = statementPeriodMonths(d.fields);
      best = {
        monthly: months !== null ? Math.round((total / months) * 100) / 100 : null,
        periodTotal: total,
        months,
        capturedOn: d.capturedOn ?? null,
        capturedKey: key,
      };
    }
  }
  if (!best) return null;
  const { monthly, periodTotal, months, capturedOn } = best;
  return { monthly, periodTotal, months, capturedOn };
}

export interface MatchResolution {
  monthly: number;
  status: ValueStatus;
  /** The exact source line for details surfaces, e.g. "From
   * statement" (the amount line above it carries the figure). */
  sourceLabel: string;
  statementOn: string | null;
  /** A statement shows an employer total but not its period
   * length: detected, honestly not paced. */
  detectedNotPaced: boolean;
}

/** Employer match resolution (spec section F order): the latest
 * regular payslip with a match line wins (AC-D1); else the member's
 * own 401(k) statement (AC-D2, GT6); else a user-confirmed figure;
 * else unknown - never $0 dressed as proof (AC-D4). A payslip that
 * prints a $0 match line IS a confirmed zero (from_payslip). */
export function employerMatchFor(input: {
  payslipMonthly: number | null;
  statement: StatementMatch | null;
  userMonthly?: number | null;
  /** True when payslips or 401(k) statements exist to be searched:
   * the item was looked for and not found (Not detected), as
   * opposed to no document existing at all (Unknown). */
  relevantDocsExist?: boolean;
}): MatchResolution {
  if (input.payslipMonthly !== null) {
    return { monthly: input.payslipMonthly, status: "from_payslip", sourceLabel: "from your payslips", statementOn: null, detectedNotPaced: false };
  }
  if (input.statement && input.statement.monthly !== null && input.statement.monthly > 0) {
    return { monthly: input.statement.monthly, status: "from_statement", sourceLabel: "From statement", statementOn: input.statement.capturedOn, detectedNotPaced: false };
  }
  if (input.userMonthly != null && input.userMonthly > 0) {
    return { monthly: input.userMonthly, status: "user_confirmed", sourceLabel: "entered by you", statementOn: null, detectedNotPaced: false };
  }
  if (input.statement) {
    return { monthly: 0, status: "not_detected", sourceLabel: "on your 401(k) statement - period length not shown", statementOn: input.statement.capturedOn, detectedNotPaced: true };
  }
  if (input.relevantDocsExist) {
    return { monthly: 0, status: "not_detected", sourceLabel: "Not detected", statementOn: null, detectedNotPaced: false };
  }
  return { monthly: 0, status: "unknown", sourceLabel: "Unknown", statementOn: null, detectedNotPaced: false };
}

// --- The directional outlook engine ---------------------------------

export interface DirectionalAdult {
  name: string;
  currentAge: number | null;
  retireAge: number;
  /** Planned years until this adult retires (0 when their age is
   * unknown, mirroring the household projection: no date of birth,
   * no timed contributions). */
  yearsToRetire: number;
  startingBalance: number;
  /** The full monthly contribution stream: employee pace + employer
   * match pace, already resolved by the caller. */
  monthly: number;
}

export interface DirectionalInput {
  adults: DirectionalAdult[];
  /** The active spending figure, today's dollars (the placeholder
   * at accuracy X - the caller flags it; the engine only computes). */
  spendingAnnual: number;
  /** Dependable income known today (Social Security + pension +
   * other), today's dollars per year. */
  dependableAnnual: number;
  withdrawalRate: number; // 0.04 Balanced
  inflationPct: number; // 2.5 default
  /** Household monthly net for the action plausibility rule (10%
   * of net). 0 = unknown: the saving lever then cannot be verified
   * as plausible and the selection falls through, per spec. */
  monthlyNet: number;
}

export interface ReachAges { r7: number | null; r6: number | null; r5: number | null }

export type OutlookRating = "on_track" | "close" | "needs_improvement" | "off_track" | "not_enough_data";

export const OUTLOOK_RATING_LABEL: Record<OutlookRating, string> = {
  on_track: "On track",
  close: "Close to target",
  needs_improvement: "Needs improvement",
  off_track: "Current path misses target",
  not_enough_data: "Not enough data",
};

/** RequiredPortfolio(t) (spec section B): the spending the portfolio
 * must fund after dependable income, divided by the withdrawal
 * rate. Today's dollars, like every figure in this engine. */
export function requiredPortfolioFor(spendingAnnual: number, dependableAnnual: number, withdrawalRate: number, spendingCutAnnual = 0): number {
  const need = Math.max(0, spendingAnnual - Math.max(0, spendingCutAnnual) - dependableAnnual);
  return withdrawalRate > 0 ? need / withdrawalRate : 0;
}

/** The reference adult (spec section 5): the adult whose retirement
 * DATE is earliest - their age is the one the card expresses.
 * Requested is their planned retirement age; Current path is the
 * range of ages at which THAT person can retire without breaking
 * the household plan (everyone else keeps their planned date, and
 * the household is valued at the common later date). Only adults
 * with a known age can anchor an age; ties go to the first adult. */
export function referenceAdultIndex(adults: DirectionalAdult[]): number {
  let best = -1;
  for (let i = 0; i < adults.length; i++) {
    if (adults[i].currentAge === null) continue;
    if (best === -1 || adults[i].yearsToRetire < adults[best].yearsToRetire) best = i;
  }
  return best;
}

/** Household assets at the common horizon, in today's dollars, when
 * the reference adult retires refYears from now and everyone else
 * keeps their planned date (the three-phase timeline of spec
 * section D, valued the way the household projection already values
 * it: contributions stop at each adult's own date, balances keep
 * growing to the common date - projectToCommonDate semantics). */
export function directionalProjected(input: DirectionalInput, refIdx: number, refYears: number, returnPct: number, addedMonthly = 0): number {
  const yearsArr = input.adults.map((a, i) => (i === refIdx ? Math.max(0, refYears) : Math.max(0, a.yearsToRetire)));
  const horizon = yearsArr.reduce((mx, y) => Math.max(mx, y), 0);
  let nominal = 0;
  input.adults.forEach((a, i) => {
    nominal += projectToCommonDate(a.startingBalance, a.monthly + (i === refIdx ? addedMonthly : 0), yearsArr[i], horizon, returnPct);
  });
  return deflateToToday(nominal, horizon, input.inflationPct);
}

/** ReachAge(r) (spec sections B/3): the earliest age of the
 * reference adult at which projected household assets reach the
 * required portfolio, searching whole years from today to age 80.
 * Null when the goal is not reached by 80 (displayed as 80+). */
export function reachAgeFor(input: DirectionalInput, refIdx: number, returnPct: number, opts?: { addedMonthly?: number; spendingCutAnnual?: number }): number | null {
  const ref = input.adults[refIdx];
  if (ref.currentAge === null) return null;
  const required = requiredPortfolioFor(input.spendingAnnual, input.dependableAnnual, input.withdrawalRate, opts?.spendingCutAnnual ?? 0);
  if (required <= 0) return ref.currentAge; // dependable income covers the target on its own
  const maxYears = Math.max(0, 80 - ref.currentAge);
  for (let y = 0; y <= maxYears; y++) {
    if (directionalProjected(input, refIdx, y, returnPct, opts?.addedMonthly ?? 0) >= required) return ref.currentAge + y;
  }
  return null;
}

export function reachAgesFor(input: DirectionalInput, refIdx: number, opts?: { addedMonthly?: number; spendingCutAnnual?: number }): ReachAges {
  return {
    r7: reachAgeFor(input, refIdx, 7, opts),
    r6: reachAgeFor(input, refIdx, 6, opts),
    r5: reachAgeFor(input, refIdx, 5, opts),
  };
}

/** The displayed range: ReachAge(7%) to ReachAge(5%), whole years,
 * 80+ when a scenario never reaches (GT4). A single age when the
 * band collapses. */
export function reachRangeLabel(reach: ReachAges): string {
  if (reach.r7 === null) return "80+";
  if (reach.r5 === null) return `${reach.r7}-80+`;
  if (reach.r7 === reach.r5) return `${reach.r7}`;
  return `${reach.r7}-${reach.r5}`;
}

/** The outlook rating (spec section C), driven by how many of the
 * three scenarios reach the desired age on time. No probability
 * percentages, ever - there is no Monte Carlo behind this. The
 * golden tests pin the boundary readings: when NO scenario is on
 * time, the earliest scenario's lateness grades the result (1 year
 * late is still Close; 2-4 years is Needs improvement; more, or
 * never, is Off track) - GT3 (reach 64/66/69 against a desired 60)
 * is Needs improvement by exactly this reading. */
export function outlookRating(desiredAge: number, reach: ReachAges): OutlookRating {
  const ages = [reach.r7, reach.r6, reach.r5];
  const onTime = ages.filter((a) => a !== null && a <= desiredAge).length;
  if (onTime === 3) return "on_track";
  const earliest = ages.reduce<number | null>((min, a) => (a === null ? min : min === null ? a : Math.min(min, a)), null);
  const earliestLateness = earliest === null ? Number.POSITIVE_INFINITY : earliest - desiredAge;
  if (onTime === 2 || earliestLateness === 1) return "close";
  if (onTime === 1 || (earliestLateness >= 2 && earliestLateness <= 4)) return "needs_improvement";
  return "off_track";
}

export interface RecommendedAction {
  kind: "none" | "save" | "delay" | "spend" | "combo";
  text: string;
  impactText: string;
  addedMonthly: number;
  yearsLater: number;
  spendingCutAnnual: number;
}

export interface DirectionalOutlook {
  sufficient: boolean;
  referenceIndex: number;
  desiredAge: number;
  reach: ReachAges;
  rangeLabel: string;
  rating: OutlookRating;
  ratingLabel: string;
  requiredPortfolio: number;
  projectedAtDesired: number;
  gapAtDesired: number;
  levers: { saveMonthly: number | null; yearsLater: number | null; spendingCutAnnual: number };
  action: RecommendedAction;
}

const NOT_ENOUGH: DirectionalOutlook = {
  sufficient: false,
  referenceIndex: -1,
  desiredAge: 0,
  reach: { r7: null, r6: null, r5: null },
  rangeLabel: "",
  rating: "not_enough_data",
  ratingLabel: OUTLOOK_RATING_LABEL.not_enough_data,
  requiredPortfolio: 0,
  projectedAtDesired: 0,
  gapAtDesired: 0,
  levers: { saveMonthly: null, yearsLater: null, spendingCutAnnual: 0 },
  action: { kind: "none", text: "", impactText: "", addedMonthly: 0, yearsLater: 0, spendingCutAnnual: 0 },
};

/** The directional outlook (spec sections B, C, E). Sufficient data
 * means: a requested retirement age exists AND the household has
 * SOME accumulation evidence - a balance or a contribution pace.
 * (The owner's own fixture state is pace-only: five payslips, no
 * balances yet - the outlook must still answer there, with balances
 * honestly $0, exactly as the household projection already treats
 * them. With neither balance nor pace there is no path to draw, and
 * the answer is Not enough data - never an invented range.) */
export function directionalOutlook(input: DirectionalInput, moneyFmt: (n: number) => string): DirectionalOutlook {
  const refIdx = referenceAdultIndex(input.adults);
  if (refIdx === -1) return NOT_ENOUGH;
  const ref = input.adults[refIdx];
  const hasBalance = input.adults.some((a) => a.startingBalance > 0);
  const hasPace = input.adults.some((a) => a.monthly > 0);
  if (!hasBalance && !hasPace) return NOT_ENOUGH;
  const desiredAge = ref.retireAge;
  const desiredYears = Math.max(0, ref.yearsToRetire);
  const reach = reachAgesFor(input, refIdx);
  const rangeLabel = reachRangeLabel(reach);
  const rating = outlookRating(desiredAge, reach);
  const required = requiredPortfolioFor(input.spendingAnnual, input.dependableAnnual, input.withdrawalRate);
  const projectedAtDesired = directionalProjected(input, refIdx, desiredYears, 6);
  const gap = Math.max(0, required - projectedAtDesired);

  // The three levers (spec section E).
  // A: minimal added monthly saving (binary search, $0-$20,000 in
  // $25 steps) that makes ReachAge(6%) reach the desired age. Null
  // when even the cap cannot do it.
  const reachesWith = (added: number) => {
    const age = reachAgeFor(input, refIdx, 6, { addedMonthly: added });
    return age !== null && age <= desiredAge;
  };
  let saveMonthly: number | null = null;
  if (reachesWith(0)) saveMonthly = 0;
  else if (reachesWith(20000)) {
    let lo = 0;
    let hi = 800; // in $25 steps
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (reachesWith(mid * 25)) hi = mid; else lo = mid + 1;
    }
    saveMonthly = lo * 25;
  }
  // B: delay to the base reach age.
  const yearsLater = reach.r6 !== null && reach.r6 > desiredAge ? reach.r6 - desiredAge : null;
  // C: the spending reduction that closes the gap at the desired
  // date by construction (gap x withdrawal rate).
  const spendingCut = Math.round(gap * input.withdrawalRate);

  const rangeWith = (opts: { addedMonthly?: number; spendingCutAnnual?: number }) => reachRangeLabel(reachAgesFor(input, refIdx, opts));
  const impactFrom = (newLabel: string) =>
    newLabel !== rangeLabel
      ? `Estimated current path improves from ${rangeLabel} to ${newLabel}.`
      : `This reaches the goal by age ${desiredAge} on the base (6%) scenario.`;

  let action: RecommendedAction;
  if (reach.r6 !== null && reach.r6 <= desiredAge) {
    action = { kind: "none", text: "No action needed - review once a year", impactText: "", addedMonthly: 0, yearsLater: 0, spendingCutAnnual: 0 };
  } else if (saveMonthly !== null && saveMonthly > 0 && input.monthlyNet > 0 && saveMonthly < 0.1 * input.monthlyNet) {
    action = {
      kind: "save",
      text: `Save about ${moneyFmt(saveMonthly)} more per month`,
      impactText: impactFrom(rangeWith({ addedMonthly: saveMonthly })),
      addedMonthly: saveMonthly, yearsLater: 0, spendingCutAnnual: 0,
    };
  } else if (yearsLater !== null && yearsLater <= 2) {
    action = {
      kind: "delay",
      text: `Retire about ${yearsLater} year${yearsLater === 1 ? "" : "s"} later, at ${reach.r6}`,
      impactText: `The current path (${rangeLabel}) reaches the goal when retirement moves to ${reach.r6} - the path itself does not change.`,
      addedMonthly: 0, yearsLater, spendingCutAnnual: 0,
    };
  } else if (spendingCut > 0 && spendingCut <= 0.1 * input.spendingAnnual) {
    action = {
      kind: "spend",
      text: `Reduce retirement spending by about ${moneyFmt(spendingCut)} per year`,
      impactText: impactFrom(rangeWith({ spendingCutAnnual: spendingCut })),
      addedMonthly: 0, yearsLater: 0, spendingCutAnnual: spendingCut,
    };
  } else {
    // The combination (AC-C6): the extra saving that, together with
    // retiring yearsLater later (or at the age-80 model cap when
    // the base scenario never reaches), reaches the goal. If the
    // delay alone does it, the action is the delay, stated plainly.
    const delayYears = yearsLater ?? Math.max(0, 80 - desiredAge);
    const comboReaches = (added: number) => {
      const age = reachAgeFor(input, refIdx, 6, { addedMonthly: added });
      return age !== null && age <= desiredAge + delayYears;
    };
    let comboSave: number | null = null;
    if (comboReaches(0)) comboSave = 0;
    else if (comboReaches(20000)) {
      let lo = 0;
      let hi = 800;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (comboReaches(mid * 25)) hi = mid; else lo = mid + 1;
      }
      comboSave = lo * 25;
    }
    if (comboSave === 0 && yearsLater !== null) {
      action = {
        kind: "delay",
        text: `Retire about ${yearsLater} year${yearsLater === 1 ? "" : "s"} later, at ${reach.r6}`,
        impactText: `The current path (${rangeLabel}) reaches the goal when retirement moves to ${reach.r6} - the path itself does not change.`,
        addedMonthly: 0, yearsLater, spendingCutAnnual: 0,
      };
    } else if (comboSave !== null && comboSave > 0) {
      action = {
        kind: "combo",
        text: `Save about ${moneyFmt(comboSave)} more per month and retire about ${delayYears} year${delayYears === 1 ? "" : "s"} later`,
        impactText: impactFrom(rangeWith({ addedMonthly: comboSave })),
        addedMonthly: comboSave, yearsLater: delayYears, spendingCutAnnual: 0,
      };
    } else if (spendingCut > 0) {
      // Last resort: the spending lever is the only finite one left
      // (even $20,000/month more and retiring at 80 do not reach).
      // Its impact is real by construction: cutting the target by
      // the gap x the withdrawal rate closes the gap at the
      // desired date.
      action = {
        kind: "spend",
        text: `Reduce retirement spending by about ${moneyFmt(spendingCut)} per year`,
        impactText: impactFrom(rangeWith({ spendingCutAnnual: spendingCut })),
        addedMonthly: 0, yearsLater: 0, spendingCutAnnual: spendingCut,
      };
    } else {
      action = { kind: "none", text: "No single action closes this gap yet - add the missing inputs to sharpen the forecast", impactText: "", addedMonthly: 0, yearsLater: 0, spendingCutAnnual: 0 };
    }
  }

  return {
    sufficient: true,
    referenceIndex: refIdx,
    desiredAge,
    reach,
    rangeLabel,
    rating,
    ratingLabel: OUTLOOK_RATING_LABEL[rating],
    requiredPortfolio: Math.round(required),
    projectedAtDesired: Math.round(projectedAtDesired),
    gapAtDesired: Math.round(gap),
    levers: { saveMonthly, yearsLater, spendingCutAnnual: spendingCut },
    action,
  };
}

// ---------------------------------------------------------------------------
// ROUND 53 - Visual status card, retirement timeline, sharpness
// gating, provenance everywhere (Copilot's focused feedback on round
// 52's device output). The round-52 engine math stands untouched:
// everything here is presentation - what may be SHOWN at each
// accuracy level, with what wording, and where each displayed value
// came from. Unknown is never zero, here or anywhere else.
// ---------------------------------------------------------------------------

/** Display color keys shared by the status line and the timeline
 * band - the same four verdict colors the gauges already use. */
export type StatusColorKey = "green" | "yellow" | "orange" | "red";

export function ratingColorKey(rating: OutlookRating): StatusColorKey {
  switch (rating) {
    case "on_track": return "green";
    case "close": return "yellow";
    case "needs_improvement": return "orange";
    default: return "red";
  }
}

/** The status shown on the Home card FACE (round 53, item 3). The
 * engine rating is never changed; only the FACE softens the harshest
 * verdict while the forecast is still an early estimate (accuracy X):
 * an off-track rating there reads "Too early to confirm", because key
 * inputs are still missing by definition at X. Everywhere else -
 * details, Scenarios, and the face at X+/X++ - the computed label
 * shows as computed. */
export function faceStatusFor(level: RetirementAccuracyLevel, rating: OutlookRating, desiredAge: number): { label: string; colorKey: StatusColorKey; support: string | null } {
  if (level === "X" && rating === "off_track") {
    return {
      label: "Too early to confirm",
      colorKey: "yellow",
      support: `Preliminary models do not yet support age ${desiredAge}, but key retirement inputs are still missing.`,
    };
  }
  return { label: OUTLOOK_RATING_LABEL[rating], colorKey: ratingColorKey(rating), support: null };
}

/** The one opportunity line on the X face (round 53, item 1), composed
 * from the accuracy missing list so it stays truthful for any
 * household: the first two missing inputs, in the sentence pattern
 * "Biggest opportunity: personalize spending + Social Security."
 * Returns null when nothing is missing. */
export function biggestOpportunityLine(missing: string[]): string | null {
  const parts: string[] = [];
  for (const m of missing) {
    if (/spending/i.test(m)) parts.push("spending");
    else if (/social security/i.test(m)) parts.push("Social Security");
    else if (/pension|dependable/i.test(m)) parts.push("pension and reliable income");
    if (parts.length === 2) break;
  }
  if (parts.length === 0) return null;
  return `Biggest opportunity: personalize ${parts.join(" + ")}. Current estimate is based on incomplete data.`;
}

// ---------------------------------------------------------------------------
// Accuracy controls sharpness (round 53, item 4). A precise dollar
// prescription - "$X/month more", "work N years longer" AS a
// recommendation - is earned only when the forecast is personalized:
//   X   - no lever figures at all outside the age range;
//   X+  - the recommended SAVINGS CHANGE figure is allowed (plus
//         projected portfolio, target portfolio, approximate gap);
//   X++ - full precise prescriptions.
// Delay and spending prescriptions stay qualitative until X++.
// ---------------------------------------------------------------------------

export type PrescriptionLevel = "none" | "savings" | "full";

export function prescriptionLevel(level: RetirementAccuracyLevel): PrescriptionLevel {
  return level === "X" ? "none" : level === "X+" ? "savings" : "full";
}

/** The recommendation text a surface may show at this accuracy level,
 * or null when no prescription text may appear. The engine's action
 * is never altered - only its display is gated. */
export function recommendedActionText(action: RecommendedAction, level: RetirementAccuracyLevel): string | null {
  if (action.kind === "none") return null;
  const p = prescriptionLevel(level);
  if (p === "none") return null;
  if (p === "savings") return action.kind === "save" ? action.text : null;
  return action.text;
}

// ---------------------------------------------------------------------------
// Provenance badges (round 53, item 6). One subtle uppercase badge
// vocabulary for every surface: PAYSLIP / STATEMENT / USER / ESTIMATE
// when a value has a source; "Not detected" when documents exist but
// the item was not found in them; "Unknown" when there is no document
// context at all. A user-typed value - including a typed zero - is
// USER: a real value, never relabelled.
// ---------------------------------------------------------------------------

export function valueStatusBadge(status: ValueStatus): string {
  switch (status) {
    case "from_payslip": return "PAYSLIP";
    case "from_statement": return "STATEMENT";
    case "user_confirmed": case "confirmed": return "USER";
    case "estimated": return "ESTIMATE";
    case "not_detected": return "Not detected";
    case "stale": return "Stale";
    default: return "Unknown";
  }
}

/** Evidence for one Lifestyle group-2 (savings / work-cost) row key.
 * 401(k), HSA, ESPP, 529 and payroll taxes are document-backed;
 * work & commuting, college support and mortgage ending have no
 * document source in the app today, so they are Not detected when
 * documents exist and Unknown when none do - never zero. */
export function group2EvidenceStatus(docs: SsDocLike[], key: string): ValueStatus {
  switch (key) {
    case "k401": {
      const slips = docs.filter((d) => d.docType === "payslip");
      if (slips.some((d) => docHasPositive(d, ["k401_contribution", "ytd_k401"]))) return "from_payslip";
      return slips.length > 0 ? "not_detected" : "unknown";
    }
    case "hsa_contrib": return docEvidenceStatus(docs, "hsa");
    case "espp": return docEvidenceStatus(docs, "espp");
    case "contrib529": return docEvidenceStatus(docs, "529");
    case "payroll_taxes": return docEvidenceStatus(docs, "payroll_taxes");
    default: return docs.length > 0 ? "not_detected" : "unknown";
  }
}

export interface RowProvenance {
  /** Subtle source badge when the shown value has one. */
  badge: string | null;
  /** The honest state word when there is no value and no source. */
  stateLabel: string | null;
}

/** Provenance for one editable group-2 row. `amount` is what the row
 * currently shows; `derivedAnnual` is the document-derived annual
 * figure for the same row (0 when the documents say nothing). */
export function group2RowProvenance(input: { amount: number; derivedAnnual: number; evidence: ValueStatus }): RowProvenance {
  const { amount, derivedAnnual, evidence } = input;
  if (amount > 0) {
    if (derivedAnnual > 0 && amount === derivedAnnual && (evidence === "from_payslip" || evidence === "from_statement" || evidence === "estimated")) {
      return { badge: valueStatusBadge(evidence), stateLabel: null };
    }
    return { badge: "USER", stateLabel: null };
  }
  // A zero shown against positive document evidence is a deliberate
  // user zero - USER, never Unknown.
  if (derivedAnnual > 0) return { badge: "USER", stateLabel: null };
  if (evidence === "from_payslip" || evidence === "from_statement" || evidence === "estimated") {
    return { badge: valueStatusBadge(evidence), stateLabel: null };
  }
  return { badge: null, stateLabel: evidence === "not_detected" ? "Not detected" : "Unknown" };
}

// ---------------------------------------------------------------------------
// The visual retirement timeline model (round 53, item 2). Pure data:
// the component draws it with plain Views. Axis: from two years below
// the youngest relevant age (current ages and desired ages) to 82,
// the right end labelled "80+". Milestone chips come ONLY from data
// the caller actually has - Medicare at 65 is an age fact and is
// always present; everything else is passed in only when known.
// ---------------------------------------------------------------------------

export interface TimelineAdultInput { name: string; currentAge: number; retireAge: number }
export interface TimelineChip { label: string; age: number }
export interface TimelineRow { name: string; firstName: string; currentAge: number; desiredAge: number; isReference: boolean }
export interface TimelineBand {
  startAge: number;
  endAge: number;
  label: string;
  unreached: boolean;
  /** Round 54: when NO scenario reaches, the band is drawn as a
   * faded run-off segment from this age to the axis end instead of
   * a solid pill at the end. Null for reached and partially reached
   * paths, whose solid band rendering is unchanged. */
  fadedStartAge: number | null;
}

/** One tick-strip label after collision-aware layout (round 54).
 * The layout is pure and deterministic: boxes come from an estimated
 * text width at the label font size, never from measured rendering,
 * so the tests and both usages (compact card, full details) agree. */
export interface TimelineLabel {
  kind: "tick" | "goal" | "range";
  text: string;
  anchorAge: number;
  /** Rendered box, in the same units as the axisWidth laid out at. */
  left: number;
  right: number;
  align: "left" | "center" | "right";
  /** "strip" = the tick strip under the axis; "above" = over the
   * axis end (the fully unreached range label). */
  placement: "strip" | "above";
  dropped: boolean;
}

export interface RetirementTimeline {
  minAge: number;
  /** Always 82 - the axis runs two years past 80 so "80+" has room. */
  maxAge: number;
  rows: TimelineRow[];
  band: TimelineBand;
  chips: TimelineChip[];
  ticks: number[];
  /** Collision-aware label layout at TIMELINE_REF_WIDTH; the
   * component re-runs timelineLabelLayout at its measured width. */
  labels: TimelineLabel[];
}

export function retirementTimelineModel(input: {
  adults: TimelineAdultInput[];
  referenceIndex: number;
  reach: ReachAges;
  rangeLabel: string;
  /** One claim age per adult who HAS a Social Security figure. */
  ssClaimAges: number[];
  /** The reference adult's age when the mortgage ends, or null. */
  mortgageEndsAge: number | null;
  /** Label carries the year; age is the reference adult's age then. */
  collegeEnds: TimelineChip[];
}): RetirementTimeline | null {
  if (input.adults.length === 0 || input.referenceIndex < 0 || input.referenceIndex >= input.adults.length) return null;
  const maxAge = 82;
  const minAge = Math.floor(Math.min(...input.adults.flatMap((a) => [a.currentAge, a.retireAge])) - 2);
  const rows: TimelineRow[] = input.adults.map((a, i) => ({
    name: a.name,
    firstName: (a.name || "").trim().split(/\s+/)[0] || a.name,
    currentAge: a.currentAge,
    desiredAge: a.retireAge,
    isReference: i === input.referenceIndex,
  }));
  const band: TimelineBand = input.reach.r7 === null
    ? {
        startAge: 80, endAge: maxAge, label: "80+", unreached: true,
        fadedStartAge: minAge + 0.85 * (maxAge - minAge),
      }
    : {
        startAge: input.reach.r7,
        endAge: input.reach.r5 === null ? maxAge : input.reach.r5,
        label: input.rangeLabel,
        unreached: input.reach.r5 === null,
        fadedStartAge: null,
      };
  const raw: TimelineChip[] = [{ label: "Medicare 65", age: 65 }];
  for (const claim of input.ssClaimAges) raw.push({ label: `Social Security ${claim}`, age: claim });
  if (input.mortgageEndsAge !== null) raw.push({ label: `Mortgage ends ${input.mortgageEndsAge}`, age: input.mortgageEndsAge });
  for (const c of input.collegeEnds) raw.push(c);
  const seen = new Set<string>();
  const chips: TimelineChip[] = [];
  for (const c of raw) {
    if (c.age < minAge || c.age > maxAge || seen.has(c.label)) continue;
    seen.add(c.label);
    chips.push(c);
  }
  chips.sort((a, b) => a.age - b.age);
  const ticks: number[] = [];
  for (let t = Math.ceil(minAge / 10) * 10; t <= maxAge; t += 10) ticks.push(t);
  const labels = timelineLabelLayout({
    minAge, maxAge, ticks,
    goalAge: rows[input.referenceIndex].desiredAge,
    band, axisWidth: TIMELINE_REF_WIDTH,
  });
  return { minAge, maxAge, rows, band, chips, ticks, labels };
}

// ---------------------------------------------------------------------------
// Tick-strip label layout (round 54, device QA). Round 53 positioned
// every label with a fixed translateX, so the "Goal 50" label landed
// on the 50 decade tick and the "80+" range label landed on the 80
// end tick - unreadable garble at both ends of the axis. The rules:
// - The goal label and the range label are NEVER dropped.
// - A decade tick that would overlap either of them (or a tick
//   already kept) is dropped; the goal label carries its number
//   anyway, and the range label is the end label when it sits at
//   the axis end.
// - If the goal and range labels collide with each other, the range
//   label slides away first (its anchor is a region, the goal's is
//   a point); if it is still colliding at the bound, the goal label
//   slides the other way.
// - Every box is clamped inside the axis: a box that would cross
//   the start is left-aligned at the start, one that would cross
//   the end is right-aligned at the end.
// - A fully unreached path carries its "80+" label ABOVE the axis
//   end, right-aligned, and the axis-end tick is dropped: the label
//   replaces it.
// ---------------------------------------------------------------------------

/** Canonical axis width the model's own labels are laid out at; the
 * component re-runs the same pure layout at its measured width. */
export const TIMELINE_REF_WIDTH = 360;
const TIMELINE_LABEL_FONT_SIZE = 12;
const TIMELINE_LABEL_GAP = 2;

/** Deterministic rendered-width estimate for a tick-strip label:
 * per-character factors at the label font size, plus padding. The
 * factors run slightly generous on purpose - an overestimate drops
 * a decade tick a hair early, while an underestimate re-creates the
 * overlap defect this layout exists to fix. */
export function timelineTextWidth(text: string, fontSize: number = TIMELINE_LABEL_FONT_SIZE): number {
  let units = 0;
  for (const ch of text) {
    if (ch >= "0" && ch <= "9") units += 0.58;
    else if (ch >= "A" && ch <= "Z") units += 0.72;
    else if (ch === " " || ch === "l" || ch === "i") units += 0.3;
    else if (ch === "-") units += 0.38;
    else if (ch === "+") units += 0.58;
    else units += 0.52;
  }
  return Math.ceil(units * fontSize) + 4;
}

export function timelineLabelLayout(input: {
  minAge: number;
  maxAge: number;
  ticks: number[];
  goalAge: number;
  band: TimelineBand;
  axisWidth: number;
}): TimelineLabel[] {
  const W = Math.max(1, input.axisWidth);
  const span = Math.max(1, input.maxAge - input.minAge);
  const x = (age: number) => ((age - input.minAge) / span) * W;
  const hit = (a: { left: number; right: number }, b: { left: number; right: number }) =>
    a.left < b.right + TIMELINE_LABEL_GAP && b.left < a.right + TIMELINE_LABEL_GAP;
  const place = (anchor: number, width: number) => {
    let left = anchor - width / 2;
    if (left < 0) left = 0;
    if (left + width > W) left = W - width;
    if (left < 0) left = 0;
    return { left, right: left + width };
  };
  const alignOf = (b: { left: number; right: number }): TimelineLabel["align"] =>
    b.left <= 0 ? "left" : b.right >= W ? "right" : "center";

  // The range label: a fully unreached path carries it above the
  // axis end, right-aligned; every other path centres it on the band.
  const rangeAbove = input.band.fadedStartAge !== null;
  const rangeWidth = timelineTextWidth(input.band.label);
  const rangeAnchorAge = rangeAbove ? input.maxAge : (input.band.startAge + input.band.endAge) / 2;
  const rangeBox = rangeAbove
    ? { left: Math.max(0, W - rangeWidth), right: W }
    : place(x(rangeAnchorAge), rangeWidth);
  const rangeLabel: TimelineLabel = {
    kind: "range", text: input.band.label, anchorAge: rangeAnchorAge,
    left: rangeBox.left, right: rangeBox.right, align: alignOf(rangeBox),
    placement: rangeAbove ? "above" : "strip", dropped: false,
  };

  const goalText = `Goal ${input.goalAge}`;
  const goalWidth = timelineTextWidth(goalText);
  const goalBox = place(x(input.goalAge), goalWidth);
  if (!rangeAbove && hit(goalBox, rangeBox)) {
    const dir = rangeBox.left + rangeWidth / 2 >= goalBox.left + goalWidth / 2 ? 1 : -1;
    let moved = dir > 0
      ? { left: goalBox.right + TIMELINE_LABEL_GAP, right: goalBox.right + TIMELINE_LABEL_GAP + rangeWidth }
      : { left: goalBox.left - TIMELINE_LABEL_GAP - rangeWidth, right: goalBox.left - TIMELINE_LABEL_GAP };
    if (moved.left < 0) moved = { left: 0, right: rangeWidth };
    if (moved.right > W) moved = { left: W - rangeWidth, right: W };
    rangeBox.left = moved.left; rangeBox.right = moved.right;
    rangeLabel.left = moved.left; rangeLabel.right = moved.right;
    rangeLabel.align = alignOf(moved);
    if (hit(goalBox, rangeBox)) {
      let g = dir > 0
        ? { left: rangeBox.left - TIMELINE_LABEL_GAP - goalWidth, right: rangeBox.left - TIMELINE_LABEL_GAP }
        : { left: rangeBox.right + TIMELINE_LABEL_GAP, right: rangeBox.right + TIMELINE_LABEL_GAP + goalWidth };
      if (g.left < 0) g = { left: 0, right: goalWidth };
      if (g.right > W) g = { left: W - goalWidth, right: W };
      goalBox.left = g.left; goalBox.right = g.right;
    }
  }
  const goalLabel: TimelineLabel = {
    kind: "goal", text: goalText, anchorAge: input.goalAge,
    left: goalBox.left, right: goalBox.right, align: alignOf(goalBox),
    placement: "strip", dropped: false,
  };

  const labels: TimelineLabel[] = [goalLabel, rangeLabel];
  const kept: { left: number; right: number }[] = rangeAbove ? [goalBox] : [goalBox, rangeBox];
  const maxTick = input.ticks.length ? Math.max(...input.ticks) : null;
  for (const t of input.ticks) {
    const text = t >= 80 ? "80+" : String(t);
    const box = place(x(t), timelineTextWidth(text));
    let dropped = kept.some((k) => hit(box, k));
    if (rangeAbove && t === maxTick) dropped = true; // the above-axis label IS the end label
    labels.push({
      kind: "tick", text, anchorAge: t, left: box.left, right: box.right,
      align: alignOf(box), placement: "strip", dropped,
    });
    if (!dropped) kept.push(box);
  }
  return labels.sort((a, b) => a.anchorAge - b.anchorAge || a.left - b.left);
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
