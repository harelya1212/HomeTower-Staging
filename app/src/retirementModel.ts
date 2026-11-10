// The household retirement computation, shared by the Home card and
// the Retirement screen (round 52). Extracted verbatim from
// HomeScreen's derivation block (rounds 18-51) so both surfaces
// render ONE model - the numbers can never drift between the card
// and its details. Round 52 adds: per-adult employer-match
// resolution with provenance (payslip > statement > unknown), the
// household monthly net for the action plausibility rule, and the
// directional outlook itself.
import {
  accumulatedBridgeDraw,
  adultStartingBalance,
  ageOn,
  biggestOpportunityLine,
  bridgeModel as buildBridgeModel,
  chooseSpending,
  deflateToToday,
  directionalOutlook,
  employerMatchFor,
  householdRetirement,
  inflateToFuture,
  k401StatementFor,
  k401StatementFacts,
  k401StatementMatchFor,
  projectToCommonDate,
  projectValue,
  requiredMonthly,
  retirementAccuracy,
  retirementTimelineModel,
  ssForMember,
  WITHDRAWAL_RATES,
  type BridgeModel,
  type DirectionalOutlook,
  type K401Facts,
  type MatchResolution,
  type RetirementTimeline,
  type StatementMatch,
} from "./goals.ts";
import type { Payslip401k, PayslipForecast } from "./payslips.ts";
import type { HouseholdState, UiMember } from "./store.tsx";

export interface AdultOutlook {
  m: UiMember;
  age: number | null;
  bal: number;
  mo: number;
  matchMo: number;
  years: number;
  projected: number;
  paceFromSlips: boolean;
  stmt401k: { balance: number; capturedOn: string | null } | null;
  /** ROUND 60 (P0-A): how this adult's starting balance is
   * composed - identified owned non-401(k) assets + the owned
   * statement's 401(k) + the genuinely unmapped fallback residual,
   * reported separately (adultStartingBalance owns the split). */
  startComposition: { knownOwnedNon401k: number; statementAmount: number; unmappedFallback: number; replaced401k: number };
  /** Round 52: the resolved employer match with its provenance -
   * the projection stream uses matchMo; the details surfaces quote
   * matchRes for the source label (AC-D5). */
  matchRes: MatchResolution;
  stmtMatch: StatementMatch | null;
  /** Round 55 (workstream F): the adult's expanded 401(k)
   * statement facts for DISPLAY in the details (composition, Mega
   * Backdoor, holdings, election - each with its provenance). The
   * forecast math never reads this: balances and pace come from
   * the round-51/52 paths above. */
  facts: K401Facts | null;
}

export interface RetirementModel {
  adults: UiMember[];
  adultOutlook: AdultOutlook[];
  incomeBasis: number;
  budgetTotalR: number;
  spendingChoice: ReturnType<typeof chooseSpending>;
  spendingTier: string;
  lifestyleConfirmed: boolean;
  spendingFromBudget: boolean;
  spendingSet: boolean;
  spendingFromDefault: boolean;
  spendingAnnual: number;
  ssPerAdult: ReturnType<typeof ssForMember>[];
  ssAnnualTotal: number;
  ssEnteredAdults: number;
  pensionStmtMonthly: number;
  memberPension: number;
  pensionFromStatement: boolean;
  pensionAnnualEff: number;
  pensionKnown: boolean;
  currentRetBalance: number;
  projNow: { yearsOwn: number[]; laterYears: number; perAtLater: number[]; nominal: number; todays: number };
  projectedToday: number;
  laterYear: number;
  hhRet: ReturnType<typeof householdRetirement>;
  readinessPct: number | null;
  realReturnPct: number;
  hhShort: number;
  hhReqMo: number;
  accuracy: ReturnType<typeof retirementAccuracy>;
  projDelay: { yearsOwn: number[]; laterYears: number; perAtLater: number[]; nominal: number; todays: number };
  delayReadiness: number | null;
  showSensitivity: boolean;
  futureNeed: number;
  supportAnnual: number;
  accuracyLine: string;
  coveredByDependable: boolean;
  retHeadline: string;
  spendingKnown: boolean;
  personalizeParts: string[];
  personalizeSentence: string;
  phases: { earlyName: string; lateName: string; y1: number; y2: number } | null;
  updatedLabel: string;
  /** Round 52: household monthly net for the 10%-of-net action
   * rule - from the payslip forecast when it exists (projected
   * gross minus projected federal and state withholding, monthly;
   * the forecast carries no net-pay figure, so withholding is the
   * measurable deduction), else 70% of the income basis, monthly. */
  monthlyNet: number;
  /** Round 52: the directional outlook (null only when there are no
   * adults at all - directionalOutlook itself reports
   * sufficient:false for the not-enough-data state). */
  directional: DirectionalOutlook | null;
  /** Round 53: the visual timeline model for the X card face and
   * the details surfaces (null unless the directional outlook has
   * enough data to draw). Chips only from data the model has. */
  timeline: RetirementTimeline | null;
  /** ROUND 59 (TRACE G): the Home card's Current-path tile label.
   * At accuracy X the numeric "80+" is replaced with words -
   * "Outside current estimate range" - because the eye remembers
   * the number, not the "Too early to confirm" beside it. The
   * details surfaces keep directional.rangeLabel itself. */
  homeRangeLabel: string | null;
  /** ROUND 59 (TRACE G): the Home card's timeline - at accuracy X
   * the same model with the "80+" band label and end-tick text
   * suppressed (the band still draws). At X+/X++ it IS `timeline`. */
  homeTimeline: RetirementTimeline | null;
  /** Round 53: the X face's one opportunity line, composed from the
   * accuracy missing list (null when nothing is missing). */
  opportunityLine: string | null;
  /** ROUND 60 (P1-B): the bridge between the two retirement dates,
   * computed from the household's own figures (null when there is
   * no bridge: one adult, or both retire together). The headline
   * projection is already net of the bridge draw; the details
   * state this model's basis in words. */
  bridge: BridgeModel | null;
}

export function computeRetirementModel(input: {
  state: HouseholdState;
  today: string;
  slipFc: PayslipForecast | null;
  k401Totals: Payslip401k | null;
  retBalance: number;
  retMonthly: number;
  effIncome: number;
  moneyFmt: (n: number) => string;
}): RetirementModel {
  const { state, today, slipFc, k401Totals, retBalance, retMonthly, effIncome, moneyFmt } = input;
  const g = state.goals;
  const adults = state.family.filter((m) => m.role === "self" || m.role === "spouse");
  const relevantDocsExist = state.intake.documents.some((d) => d.docType === "payslip" || d.docType === "401k_statement");
  const adultOutlook: AdultOutlook[] = adults.map((m) => {
    const age = ageOn(m.dob, today);
    const owned = state.assets.filter((a) => (a.kind === "401k" || a.kind === "ira" || a.kind === "hsa") && m.name.trim() !== "" && a.ownerName.trim().toLowerCase() === m.name.trim().toLowerCase());
    // Statement precedence (round 51, Copilot's source doctrine:
    // statements say what the household HAS): an owned 401(k)
    // statement's ending balance is this adult's 401(k) starting
    // balance - it replaces their own 401(k) asset rows inside the
    // composition, so the same account never counts twice.
    // adultStartingBalance owns the rule; with no owned statement
    // it reproduces the pre-round-51 composition exactly.
    const stmt401kDoc = k401StatementFor(state.intake.documents, m.id);
    const start = adultStartingBalance({ owned, fallback: m.role === "self" ? retBalance : 0, statement401k: stmt401kDoc?.balance ?? 0 });
    const bal = start.balance;
    const stmt401k = start.statementApplied && stmt401kDoc ? { balance: stmt401kDoc.balance, capturedOn: stmt401kDoc.capturedOn } : null;
    const assetMo = owned.length ? owned.reduce((s, a) => s + a.monthly, 0) : m.role === "self" ? retMonthly : 0;
    // Payslip evidence (owner QA, 2026-11-08): when no asset row
    // carries a monthly figure, the payroll pace the payslips prove
    // is the pace - the outlook must not claim $0/mo for a household
    // whose slips show thousands a month going into the 401(k).
    // Entered assets still win when they exist.
    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
    const slipEarner = k401Totals?.perEarner.find((e) => norm(e.name) === norm(m.name))
      ?? k401Totals?.perEarner.find((e) => { const a = norm(e.name).split(" "); const b = norm(m.name).split(" "); return a.length > 1 && b.length > 1 && a[0] === b[0] && a[a.length - 1] === b[b.length - 1]; });
    const paceFromSlips = !(assetMo > 0) && slipEarner?.monthlyPace != null && slipEarner.monthlyPace > 0;
    const mo = assetMo > 0 ? assetMo : paceFromSlips ? slipEarner!.monthlyPace! : assetMo;
    // Employer match (round 51, extended by round 52's provenance
    // order): when no entered asset row carries a monthly figure,
    // the match joins the contribution stream as its own component,
    // resolved payslip first, then the adult's own 401(k) statement
    // (spec AC-D1/D2) - it accumulates in the projection, is
    // displayed on its own line with its source, and is never
    // folded into the employee figure. With no source at all it is
    // Unknown - and contributes nothing, which is not the same as
    // a confirmed $0.
    const stmtMatch = k401StatementMatchFor(state.intake.documents, m.id);
    const matchRes = employerMatchFor({ payslipMonthly: slipEarner?.matchMonthlyPace ?? null, statement: stmtMatch, relevantDocsExist });
    const matchMo = assetMo > 0 ? 0 : matchRes.monthly;
    const startComposition = { knownOwnedNon401k: start.knownOwnedNon401k, statementAmount: start.statementAmount, unmappedFallback: start.unmappedFallback, replaced401k: start.replaced401k };
    if (age === null) return { m, age, bal, mo, matchMo, years: 0, projected: 0, paceFromSlips, stmt401k, startComposition, matchRes, stmtMatch, facts: k401StatementFacts(state.intake.documents, m.id) };
    const years = Math.max(0, (m.retireAge || 67) - age);
    const projected = projectValue(bal, mo + matchMo, years, g.assumedReturnPct);
    return { m, age, bal, mo, matchMo, years, projected, paceFromSlips, stmt401k, startComposition, matchRes, stmtMatch, facts: k401StatementFacts(state.intake.documents, m.id) };
  });

  // Retirement is a HOUSEHOLD goal (round 46, Copilot's pension
  // review): the spending target minus dependable income (Social
  // Security + pension + other), divided by a starting withdrawal
  // rate - never a per-person figure doubled, because a couple
  // shares housing, utilities, insurance and food. Per-person rows
  // below stay as attribution: balances and accounts ARE personal.
  const incomeBasis = slipFc ? slipFc.projectedGross : effIncome;
  // Round 48: the spending target's source, in order - the
  // Retirement Lifestyle page once the household confirms it (built
  // from actual spending), then a custom figure, then the budget
  // worksheet, then the 70%-of-income fallback. The fallback is a
  // placeholder and is labelled as one - never as the household's
  // own target.
  // Round 49: the confirmed figure is the EFFECTIVE lifestyle figure
  // (category model + exception overlays), and the quick estimate
  // joins the precedence between the budget worksheet and the
  // fallback - chooseSpending in goals.ts owns the order and tiers.
  const budgetTotalR = (g.retirementBudget.housing || 0) + (g.retirementBudget.food || 0) + (g.retirementBudget.healthcare || 0) + (g.retirementBudget.travel || 0) + (g.retirementBudget.other || 0);
  const spendingChoice = chooseSpending({ lifestyle: g.lifestyle, exceptions: g.exceptions, customAnnual: g.retirementSpendingAnnual || 0, budgetTotal: budgetTotalR, quick: g.quickEstimate, fallback: Math.round(incomeBasis * 0.7) });
  const spendingTier = spendingChoice.tier;
  const lifestyleConfirmed = spendingTier === "confirmed";
  const spendingFromBudget = spendingTier === "set" && !(g.retirementSpendingAnnual > 0) && budgetTotalR > 0;
  const spendingSet = spendingTier !== "none"; // a quick estimate counts as supplied (round 49)
  const spendingFromDefault = !spendingSet;
  const spendingAnnual = spendingChoice.spendingAnnual;
  // Social Security per adult (round 49): a typed figure wins, else
  // the adult's own Social Security statement (monthly benefit x 12).
  const ssPerAdult = adults.map((m) => ssForMember(m, state.intake.documents));
  const ssAnnualTotal = ssPerAdult.reduce((sum, r) => sum + r.annual, 0);
  const ssEnteredAdults = ssPerAdult.filter((r) => r.annual > 0).length;
  const pensionStmtMonthly = state.intake.documents.reduce((best, d) => {
    if (d.docType !== "pension_statement" || !d.fields) return best;
    const v = Number(String(d.fields["monthly_benefit"] ?? "").replace(/[^0-9.]/g, ""));
    return Number.isFinite(v) && v > best ? v : best;
  }, 0);
  const memberPension = adults.reduce((sum, m) => sum + (m.pensionAnnual || 0), 0);
  const pensionFromStatement = memberPension <= 0 && !(g.pensionAnnual > 0) && pensionStmtMonthly > 0;
  const pensionAnnualEff = memberPension > 0 ? memberPension : g.pensionAnnual > 0 ? g.pensionAnnual : Math.round(pensionStmtMonthly * 12);
  const pensionKnown = memberPension > 0 || g.pensionAnnual > 0 || pensionStmtMonthly > 0 || g.noPension;
  const currentRetBalance = adultOutlook.reduce((sum, a) => sum + a.bal, 0);
  // Timeline (round 47): every adult is valued at the LATER
  // retirement date - contributions stop at their own date and
  // the balance keeps growing to the common date. All household
  // figures are then deflated to today's dollars, because the
  // spending target is in today's dollars.
  // ROUND 60 (P1-B): the bridge between the two dates is no
  // longer assumed free. The gap between the household's bridge
  // needs and the working spouse's net income plus dependable
  // income is computed (bridgeModel in goals.ts) and DRAWN from
  // the early retiree's projected value, accumulated at the
  // assumed return. Term sourcing: spending = the model's
  // spendingAnnual; healthcare = the bridge-healthcare figure
  // from the Lifestyle exceptions / quick estimate (0 when unset);
  // debt service = the mortgage payment x 12 while the mortgage
  // continues into retirement (0 when it ends); taxes = taxes
  // beyond the working spouse's own withholding, which is already
  // inside their net - not modeled today, so 0; the working
  // spouse's net = their own payslip-forecast projection (gross
  // minus their federal and state withholding), 0 when no earner
  // projection matches them.
  const bridgeHealthcareAnnual = (g.exceptions.healthcareBridgeAnnual || 0) || (g.quickEstimate.healthcareBridgeAnnual || 0);
  const bridgeMortgageEnds = g.exceptions.mortgageAtRetirement === "ends" || g.lifestyle.states["housing"] === "ends";
  const bridgeDebtServiceAnnual = bridgeMortgageEnds ? 0 : (g.exceptions.mortgageMonthly || 0) * 12;
  const flexYearsOf = (m: (typeof adults)[number]) => (m.retireFlex === "plus1" ? 1 : m.retireFlex === "plus3" || m.retireFlex === "flexible" ? 3 : 0);
  const projectHousehold = (delay: boolean) => {
    const yearsOwn = adultOutlook.map((a) => a.years + (delay ? flexYearsOf(a.m) : 0));
    const laterYears = yearsOwn.reduce((mx, y) => Math.max(mx, y), 0);
    const perAtLater = adultOutlook.map((a, i) => projectToCommonDate(a.bal, a.mo + a.matchMo, yearsOwn[i], laterYears, g.assumedReturnPct));
    let bridge: BridgeModel | null = null;
    if (adultOutlook.length >= 2) {
      const earlyIdx = yearsOwn.indexOf(Math.min(...yearsOwn));
      const lateIdx = yearsOwn.indexOf(laterYears);
      const bridgeYears = laterYears - yearsOwn[earlyIdx];
      if (earlyIdx !== lateIdx && bridgeYears >= 0.5) {
        const late = adultOutlook[lateIdx].m;
        const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
        const earner = slipFc?.earners.find((e) => e.memberId !== null && e.memberId === late.id)
          ?? slipFc?.earners.find((e) => norm(e.name) === norm(late.name));
        const workingSpouseNetAnnual = earner ? Math.max(0, earner.projectedGross - earner.projectedFederal - earner.projectedState) : 0;
        bridge = buildBridgeModel({
          spendingAnnual,
          healthcareAnnual: bridgeHealthcareAnnual,
          taxesAnnual: 0,
          debtServiceAnnual: bridgeDebtServiceAnnual,
          workingSpouseNetAnnual,
          dependableAnnual: ssAnnualTotal + pensionAnnualEff + (g.otherRetirementIncomeAnnual || 0),
        }, bridgeYears);
        // The draw comes out of the portfolio (Copilot's rule:
        // portfolioDrawDuringBridge = bridgeGapAnnual) - the
        // earliest-retired sleeve first, then the next, floored
        // at zero: a portfolio cannot be drawn below nothing, and
        // capping the draw at the first sleeve would silently
        // shrink the stated gap to whatever that sleeve held.
        let drawLeft = accumulatedBridgeDraw(bridge.gapAnnual, bridgeYears, g.assumedReturnPct);
        if (drawLeft > 0) {
          const order = yearsOwn.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
          for (const { i } of order) {
            if (drawLeft <= 0) break;
            const take = Math.min(perAtLater[i], drawLeft);
            perAtLater[i] -= take;
            drawLeft -= take;
          }
        }
      }
    }
    const nominal = perAtLater.reduce((sum, v) => sum + v, 0);
    return { yearsOwn, laterYears, perAtLater, nominal, todays: deflateToToday(nominal, laterYears, g.inflationPct), bridge };
  };
  const projNow = projectHousehold(false);
  const projectedToday = projNow.todays;
  const thisYearR = Number(today.slice(0, 4));
  const laterYear = thisYearR + Math.round(projNow.laterYears);
  const hhRet = householdRetirement({ spendingAnnual, socialSecurityAnnual: ssAnnualTotal, pensionAnnual: pensionAnnualEff, otherAnnual: g.otherRetirementIncomeAnnual || 0, projectedPortfolio: projectedToday });
  const readinessPct = hhRet.needBase > 0 ? Math.round((projectedToday / hhRet.needBase) * 100) : null;
  const realReturnPct = Math.max(0, ((1 + g.assumedReturnPct / 100) / (1 + (g.inflationPct || 0) / 100) - 1) * 100);
  const hhShort = Math.max(0, hhRet.needBase - projectedToday);
  const hhReqMo = hhRet.needBase > 0 && projNow.laterYears > 0 ? Math.round(requiredMonthly(currentRetBalance, hhRet.needBase, projNow.laterYears, realReturnPct)) : 0;
  const accuracy = retirementAccuracy({ spendingSet, ssEnteredAdults, adultCount: adults.length, pensionKnown, hasBalances: currentRetBalance > 0, hasPace: adultOutlook.some((a) => a.mo > 0) });
  const projDelay = projectHousehold(true);
  const delayReadiness = hhRet.needBase > 0 ? Math.round((projDelay.todays / hhRet.needBase) * 100) : null;
  const showSensitivity = projDelay.laterYears > projNow.laterYears && readinessPct !== null && readinessPct < 100 && delayReadiness !== null && delayReadiness > readinessPct;
  const futureNeed = Math.round(inflateToFuture(hhRet.needBase, projNow.laterYears, g.inflationPct));
  const supportAnnual = Math.round(projectedToday * WITHDRAWAL_RATES.base);
  // Round 48 card-face model (Copilot's UX verdict on round 47):
  // five seconds to understand - one status headline, three tiles,
  // the accuracy line, one next action. At accuracy X the fallback
  // target is product-invalid as a displayed target, so the face
  // shows no target figure and no readiness % at all.
  const accuracyLine = accuracy.level === "X" ? "Retirement estimate - early estimate, personalization needed." : accuracy.level === "X+" ? "Planning forecast." : "High-confidence planning forecast.";
  const coveredByDependable = spendingAnnual > 0 && hhRet.portfolioGapAnnual <= 0;
  const retHeadline = coveredByDependable || (hhRet.needBase > 0 && projectedToday >= hhRet.needBase) ? "On track" : accuracy.level === "X++" ? "Projected shortfall" : "Needs attention";
  const spendingKnown = spendingTier === "confirmed"; // round 49: only a confirmed lifestyle figure earns "Your household target"
  const personalizeParts = accuracy.missing.map((mm) => (mm.includes("spending") ? "retirement spending" : mm.includes("Social Security") ? "Social Security" : "pension or other reliable income"));
  const personalizeSentence = personalizeParts.length > 0 ? `Add ${personalizeParts.length > 1 ? `${personalizeParts.slice(0, -1).join(", ")} and ${personalizeParts[personalizeParts.length - 1]}` : personalizeParts[0]} to personalize it.` : "";
  const phases = (() => {
    if (adultOutlook.length < 2) return null;
    const order = projNow.yearsOwn.map((y, i) => ({ y, i })).sort((x, z) => x.y - z.y);
    if (order.length < 2 || Math.abs(order[0].y - order[1].y) < 0.5) return null;
    const early = adultOutlook[order[0].i];
    const late = adultOutlook[order[1].i];
    return { earlyName: early.m.name || "One spouse", lateName: late.m.name || "the other", y1: thisYearR + Math.round(order[0].y), y2: thisYearR + Math.round(order[1].y) };
  })();
  const updatedLabel = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][Number(today.slice(5, 7)) - 1] + " " + today.slice(0, 4);

  // Round 52: monthly net (see the interface note) and the
  // directional outlook over the same composition the household
  // projection uses - placeholder spending included, flagged by
  // the caller through spendingTier, never renamed a target.
  const monthlyNet = slipFc
    ? Math.max(0, (slipFc.projectedGross - slipFc.projectedFederal - slipFc.projectedState) / 12)
    : Math.max(0, (incomeBasis * 0.7) / 12);
  const directional = adults.length > 0
    ? directionalOutlook({
        adults: adultOutlook.map((a) => ({
          name: a.m.name,
          currentAge: a.age,
          retireAge: a.m.retireAge || 67,
          yearsToRetire: a.years,
          startingBalance: a.bal,
          monthly: a.mo + a.matchMo,
        })),
        spendingAnnual,
        dependableAnnual: ssAnnualTotal + pensionAnnualEff + (g.otherRetirementIncomeAnnual || 0),
        withdrawalRate: WITHDRAWAL_RATES.base,
        inflationPct: g.inflationPct || 0,
        monthlyNet,
      }, moneyFmt)
    : null;

  // Round 53: the X face's opportunity line and the visual
  // timeline. Chips only from data the model actually has: a Social
  // Security chip per adult with a figure on file, the mortgage
  // chip when the household data says the mortgage ends, a college
  // chip per child whose college end year can be derived.
  const opportunityLine = biggestOpportunityLine(accuracy.missing);
  const timeline = (() => {
    if (!directional || !directional.sufficient || directional.referenceIndex < 0) return null;
    const refAge = adultOutlook[directional.referenceIndex]?.age;
    if (refAge === null || refAge === undefined) return null;
    const tlAdults: { name: string; currentAge: number; retireAge: number }[] = [];
    let refIdx = -1;
    adultOutlook.forEach((a, i) => {
      if (a.age === null) return;
      if (i === directional.referenceIndex) refIdx = tlAdults.length;
      tlAdults.push({ name: a.m.name || (a.m.role === "self" ? "You" : "Spouse"), currentAge: a.age, retireAge: a.m.retireAge || 67 });
    });
    if (refIdx < 0) return null;
    const ssClaimAges = adults
      .map((m, i) => (ssPerAdult[i] && ssPerAdult[i].annual > 0 ? m.ssClaimAge || 67 : null))
      .filter((v): v is number => v !== null);
    const mortgageEnds = g.exceptions.mortgageAtRetirement === "ends" || g.lifestyle.states["housing"] === "ends";
    const thisYear = Number(today.slice(0, 4));
    const collegeEnds: { label: string; age: number }[] = [];
    for (const child of state.family) {
      if (child.role !== "child") continue;
      let endYear: number | null = null;
      if (child.studentNow && (child.yearsLeftInCollege || 0) > 0) endYear = thisYear + (child.yearsLeftInCollege || 0);
      else if ((child.collegeStartYear || 0) > 0) endYear = (child.collegeStartYear || 0) + (child.eduDurationYears || 4);
      else if (child.dob) {
        const by = Number(child.dob.slice(0, 4));
        if (by > 1900) endYear = by + 18 + (child.eduDurationYears || 4);
      }
      if (endYear !== null) collegeEnds.push({ label: `College ends ${endYear}`, age: refAge + (endYear - thisYear) });
    }
    return retirementTimelineModel({
      adults: tlAdults,
      referenceIndex: refIdx,
      reach: directional.reach,
      rangeLabel: directional.rangeLabel,
      ssClaimAges,
      mortgageEndsAge: mortgageEnds ? directional.desiredAge : null,
      collegeEnds,
    });
  })();

  // ROUND 59 (TRACE G): at accuracy X, the Home card's tile and
  // timeline callout drop the numeric "80+" (the details surfaces
  // keep the full model untouched).
  const atX = accuracy.level === "X";
  const homeRangeLabel = directional
    ? atX && directional.rangeLabel.includes("80+") ? "Outside current estimate range" : directional.rangeLabel
    : null;
  const homeTimeline = timeline && atX
    ? {
        ...timeline,
        suppressEightyPlus: true,
        band: { ...timeline.band, label: timeline.band.label.includes("80+") ? "" : timeline.band.label },
        labels: timeline.labels.map((l) => (l.text === "80+" ? { ...l, text: "", dropped: true } : l)),
      }
    : timeline;

  return {
    adults, adultOutlook, incomeBasis, budgetTotalR, spendingChoice, spendingTier, lifestyleConfirmed,
    spendingFromBudget, spendingSet, spendingFromDefault, spendingAnnual, ssPerAdult, ssAnnualTotal,
    ssEnteredAdults, pensionStmtMonthly, memberPension, pensionFromStatement, pensionAnnualEff,
    pensionKnown, currentRetBalance, projNow, projectedToday, laterYear, hhRet, readinessPct,
    realReturnPct, hhShort, hhReqMo, accuracy, projDelay, delayReadiness, showSensitivity,
    futureNeed, supportAnnual, accuracyLine, coveredByDependable, retHeadline, spendingKnown,
    personalizeParts, personalizeSentence, phases, updatedLabel, monthlyNet, directional,
    timeline, opportunityLine, homeRangeLabel, homeTimeline, bridge: projNow.bridge,
  };
}
