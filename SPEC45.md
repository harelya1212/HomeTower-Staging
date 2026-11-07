# SPEC45.md - Universal Master Spec (adopted 2026-11-07)

Source: "HOUSEHOLD FINANCIAL CONTROL TOWER - Universal Master Product &
Intelligence Specification" (45 sections), read in full by Bob from Assaf's
screenshots (reading log: workspace/hometower/spec-45-reading.md) and ADOPTED
by Assaf on 2026-11-07 as HomeTower's master product spec. It sits ABOVE
PHASE1.md: the spec defines the whole product; PHASE1.md defines what ships
in which phase. Assaf's clean vision (VISION.md) remains the commercial
constitution (ads only, zero cost, user brings user, local first).

## The product in one line
Know where your household stands today, where it is heading, what could go
wrong, and what to do next, before financial surprises become expensive.
Loop: Know. Predict. Act. Verify. (sec. 45)

## Core principles
- Prevent financial surprises; invert the old model (event -> problem ->
  discovered months later) into continuous forecast -> risk detection ->
  recommendation -> action -> verification (sec. 1-2).
- Not a dashboard: a household financial controller + planner + simulator +
  document manager. Does not replace a CPA / attorney / adviser (sec. 3).
- Universal user model: assume NOTHING (not married, not W-2, not Arizona,
  not homeowner). Everything is discovered in onboarding (sec. 4).
- Simplicity rule: complex inside, simple outside (sec. 41).
- Recommendation rule: ONE best action, in the format RECOMMENDED / WHY /
  EXPECTED BENEFIT / TRADE-OFF / CONFIDENCE / WHAT COULD CHANGE THE ANSWER
  (sec. 42).
- Success metric: the user receives important information early enough to
  change the outcome (sec. 43).

## Structure (all 45 sections)
1. North Star - four questions: Where are we? Where are we heading? Where
   do we want to be? What should we do now?
2. The Fundamental Problem - reactive household finance; the new model.
3. Product Philosophy - controller, not dashboard; not a professional
   replacement.
4. Universal User Model - nothing assumed.
5. Phase 0: Understand the Household - structure, filing status, states,
   adults, dependents, children + DOBs, students, elderly dependents.
6. Understand Employment & Income - 15 questions per adult (employed,
   self-employed, multiple jobs, employer, salary, pay frequency, bonus,
   commission, RSUs, ESPP, options, partnership, rental, gig, pension).
   The answers determine which documents are required later.
7. Understand What the Household Owns - cash, retirement (401k/403b/457/
   IRA/Roth/SEP/SIMPLE/pension/legacy), HSA/FSA, investments (brokerage,
   employer shares, RSU/ESPP/options, crypto, bonds, funds), education
   (529/Coverdell/custodial), real estate per property, other assets.
8. Understand What the Household Owes - per liability: balance, rate,
   payment, term, tax treatment, collateral.
9. Understand Household Goals - tax outcome preference (federal + state),
   retirement per adult (age, flexibility, spending, location,
   mortgage-free, part-time, legacy), children/college funding choices,
   purchases (amount/date/cash/max debt), emergency reserve months.
10. Digital Financial Twin - normalized household model; every fact has
    value, owner, source, source date, confidence, last verified, expected
    refresh frequency.
11. Data Authority Model - 8-level source priority (official document
    first, system assumption last); every fact is CONFIRMED / ESTIMATED /
    ASSUMED / STALE / MISSING / PENDING VERIFICATION.
12. Accuracy X: Directional (±15-20%).
13. Accuracy X+: Planning Grade (±7-10%).
14. Accuracy X++: Decision Grade (±3-5%).
15. Accuracy X+++: Filing Grade (~1-2%, tax-software level). Final forms
    only; NEVER estimate a material missing number; display "MISSING FOR
    FINAL CALCULATION".
16. Smart Document Request Engine - the profile determines the request
    list (W-2 employee / brokerage investor / RSU employee / HSA household
    / college student / rental owner lists).
17. Data Refresh Cadence Engine - per-payroll-cycle extraction (12 fields);
    the intelligent shortcut: 3 no-change questions instead of a PDF,
    provisional status, periodic full verification.
18. Monthly Documents - brokerage, retirement, HSA, mortgage, 529.
19. Quarterly Inputs - bonus, RSU, ESPP, realized gains, retirement pace,
    education withdrawals, tax trajectory.
20. Annual Planning Cycle - January reset; quarterly health check; June
    mid-year review; Sep/Oct landing forecast; November final optimization
    window; December Final Tax Lock (know the outcome BEFORE Dec 31).
21. Tax Control Engine - continuous projection: income, AGI, deductions,
    taxable income, marginal bracket, effective rate, next-bracket
    distance, federal + state tax, Additional Medicare Tax, NIIT, credits,
    withholding, estimated payments, refund/owe. Display target / forecast
    / delta for federal and state.
22. Refund Target Engine - user-defined targets (e.g. federal $2K-$3K,
    state $1K-$3K); green/yellow/red vs target; ALSO show the cash-flow
    cost of achieving the target - never maximize a refund blindly.
23. Retirement Scenario Engine - per adult: desired / earliest /
    alternative dates; Conservative / Base / Optimistic (5% / 7% / 9%);
    models 401k, IRA, Roth, Mega Backdoor, HSA, taxable, Social Security,
    pension, real estate, debt, healthcare, inflation.
24. Household Retirement Scenarios - one spouse first (bridge period),
    both together, early retirement (pre-Medicare healthcare), delayed
    retirement (value of extra years).
25. Retirement Lifestyle Engine - required portfolio AFTER Social Security,
    pension, rental and other reliable income; express as lifestyle
    supported under assumptions, never a bare "you need $XM".
26. Stock / Equity Engine - track stocks, ETFs, vested RSUs, unvested
    RSUs, ESPP, brokerage cash, retirement equities separately; unvested
    RSUs are NEVER liquid net worth.
27. Employer Stock Concentration - vs taxable investments, investable
    assets, liquid net worth; <20% manageable, 20-35% watch, 35-50% high,
    >50% severe.
28. Mandatory Pre-Sale TaxImpact Simulator - basis, adjusted basis,
    holding period, ST/LT, federal incremental tax, LTCG rate, NIIT, state
    tax, loss offset, wash sale, net proceeds, bracket impact; SELL NOW vs
    WAIT FOR LONG TERM.
29. Tax vs Market Risk Break-Even - tax savings from waiting / position =
    break-even decline %.
30. Equity Scenarios - hold, sell for cash, reduce concentration, RSU
    sell-at-vest, ESPP immediate, ESPP qualifying, tax-loss harvesting,
    gain harvesting, wait for LT, major decline.
31. Stress Testing - market -10/-20/-30%, employer stock -20/-40/-60%;
    effect on liquid net worth, retirement date, education, purchases.
32. Education Funding Engine - per child: balance, monthly contribution,
    years to college, duration, scholarship, tuition, room & board, books,
    inflation, return -> start balance, annual withdrawal, final balance,
    gap, required monthly contribution.
33. Education Tax Coordination - no double dipping across scholarships,
    529, AOTC, LLC; track 1098-T, 1099-Q, bursar statements, qualified
    expenses.
34. Real Estate Engine - per property: value, mortgage, equity, rate,
    payment, interest, tax, rental status/income/expenses, passive losses;
    feeds net worth, tax, retirement.
35. Major Purchase Engine - cash vs securities vs loan vs combination;
    tax impact, interest cost, retirement opportunity cost, reserve
    impact, concentration benefit; ONE preferred funding plan.
36. Household Resilience - emergency fund, months of expenses, debt,
    insurance, income + employer concentration, liquidity, upcoming
    obligations.
37. Recommendation Tracker - every recommendation: owner, action, why,
    dollar impact, due date, status, verification.
38. Monthly Snapshot - preserve income, net pay, withholding, projected
    refund, retirement, brokerage, concentration, HSA, 529, mortgages,
    net worth, recommendations. A real financial history.
39. Primary User Experience - the main screen answers "Where are we?" with
    traffic lights (TAX / RETIREMENT / COLLEGE / STOCK RISK / DOCUMENTS)
    and one NEXT ACTION.
40. "What is our status?" Command - freshness, tax alignment, federal,
    state, cash flow, HSA, retirement + scenarios, brokerage, stock
    scenarios, TaxImpact opportunities, education.
41. Simplicity Rule - complex inside (tax, OCR, forecasting, Monte Carlo,
    wash sale, NIIT, basis, brackets, 529 coordination, passive losses),
    simple outside ("You're on track." / "You're projected to owe $4,200.
    Increase Federal withholding by $350/paycheck.").
42. Recommendation Rule - one best action; RECOMMENDED / WHY / EXPECTED
    BENEFIT / TRADE-OFF / CONFIDENCE / WHAT COULD CHANGE THE ANSWER.
43. Core Success Metric - information early enough to change the outcome.
44. Financial Health Score - 0-100: Tax Control 20%, Retirement Readiness
    20%, Liquidity 15%, Debt Sustainability 10%, Education Funding 10%,
    Diversification 10%, Data Completeness 5%, Insurance/Resilience 5%,
    Goal Progress 5%. ALWAYS show the reasons (up/down drivers), never the
    bare score. NOTE: this is financial HEALTH - not the data-confidence
    score (sec. 10-15). The two are never merged or confused.
45. The Master Goal - Know. Predict. Act. Verify.

## Adoption decision (Assaf, 2026-11-07)
- SPEC45 is the master spec. Phasing (PHASE1.md) still governs what ships
  when; the Nov 6 wedge decision stands.
- Phase 1 additions approved 2026-11-07, in this order: (1) sec. 16
  profile-driven document requests, (2) sec. 17 intelligent payroll
  shortcut, (3) sec. 39+42 one NEXT ACTION in the sec. 42 format (the
  approved gauges stay), (4) sec. 20 annual cycle as a reminder layer.
- Phase 2 gate candidates: sec. 44 Health Score, sec. 37 Recommendation
  Tracker, sec. 23-24 retirement scenarios.
- Still deferred until a later gate: sec. 31 stress testing, sec. 34 full
  real-estate engine, sec. 35 major purchase engine, sec. 30 full equity
  scenario set, all-50-states packs, commercial partner links.
