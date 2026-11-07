# HomeTower - PHASE 1 SPEC

## Phase 1 wedge (the launch scope, frozen)
1. Document intake + data extraction: simple upload of any financial file; the profile fills from documents, the user confirms or corrects. Typing is last resort.
2. Tax projection: federal + ONE state, live across the year, measured against a user-set refund target band. Paystub-driven.
3. Monthly household snapshot ("מה מצבנו?"): one screen, one big number per topic, traffic-light status, top 3 actions only.
4. TaxImpact: one pre-sale simulation from ONE brokerage import format - sell now vs wait, ST/LT, capital-loss carryforward, wash sale, NIIT, state tax.

## Phase 1 enablers (also in scope)
- Household intake page: family data, dates, state, filing status, goals. Minimum fields for Accuracy Level X first; every added document unlocks more.
- Graphics: financial in look, simple in understanding. Refund gauge vs target, red/yellow/green per topic, one forecast line forward.
- Link infrastructure, built but INACTIVE commercially: config-driven links (content pack, no code change), click measurement, partner-disclosure slot. Phase 1 shows official links only (IRS, state tax authority, SSA).
- Measurement from day one: activation, intake completion, month-2 return.

## Accuracy levels (shown to the user, never hidden)
- X - Directional (+/-15-20%): broad balances and goals.
- X+ - Planning (+/-7-10%): latest payslips, elections, balances, 529.
- X++ - Decision grade (+/-3-5%): YTD payroll, known events, gain/loss export, carryforwards.
- X+++ - Filing grade (~1-2%): final official forms only. Missing material numbers are flagged, never estimated.

## Success gate for Phase 1 (defined before code)
Beta households that: complete intake, receive a projection against their target, and return in month 2 for the next snapshot. If that does not happen, the problem is the product, not the marketing.

## Equity and foreign scope (decided 2026-11-07, on the owner's question)
- Phase 1 TaxImpact models purchased lots. A post-vest RSU sale is modelled as a normal lot (basis = vest-date value, holding period from vest). ESPP shares after a disqualifying disposition likewise.
- The intake ASKS about RSU, ESPP and non-US accounts/income from day one and flags them as not-yet-modelled - the app states the limit instead of estimating (accuracy rules).
- Deferred to the Stock/Equity Scenario Engine phase: RSU vesting tracker with the 22% supplemental-withholding gap, ESPP qualifying/disqualifying disposition classification.
- Deferred, separate module: foreign-source income and accounts (FBAR, Form 8938, foreign tax credit, treaties).

## DEFERRED - re-examine at phase gates, do not delete
- Full Retirement Scenario Engine (per-spouse, 10/12/15 years)
- Full Stock / Equity Scenario Engine
- Full Education Engine per child (incl. AOTC, 1098-T / 1099-Q coordination)
- Major Purchase Engine
- Full 401(k) / Mega Backdoor / HSA limit tracking and payroll forecasting
- Full capital / passive / QBI loss rules
- All-50-states tax packs
- Monetised partner links (activate in Phase 2, gated on proven retention, proven projection accuracy against filed returns, and disclosure in place; first vertical: filing services at the end of the projection cycle)
- The two weak model assumptions under re-examination: ads-only revenue, viral growth
